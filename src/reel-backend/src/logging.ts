import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ReelConfig } from "./config.js";

export const requestContext = new AsyncLocalStorage<string>();

export const currentRequestId = () => requestContext.getStore() ?? "-";

const LEVELS: Record<string, number> = { DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40 };

const SECRET_KEY = /(authorization|cookie|api[-_]?key|token|secret|password|credential|x-gemini-api-key)/i;
const SECRET_VALUE = /(AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_.-]+|Bearer\s+[0-9A-Za-z_.=-]+)/g;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] =
        SECRET_KEY.test(key) && !(typeof item === "number" && Number.isFinite(item))
          ? "[REDACTED]"
          : redact(item);
    }
    return out;
  }
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[REDACTED]");
  return value;
}

export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…[+${text.length - limit} chars]`;
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

function timestamps(date = new Date()) {
  const json = date.toISOString();
  const text = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())},${pad(date.getMilliseconds(), 3)}`;
  return { json, text };
}

class RotatingFile {
  constructor(
    private readonly file: string,
    private readonly maxBytes = 5_000_000,
    private readonly backups = 5,
  ) {}

  write(line: string) {
    const bytes = Buffer.byteLength(line);
    if (existsSync(this.file) && statSync(this.file).size + bytes > this.maxBytes) {
      for (let index = this.backups; index >= 1; index -= 1) {
        const source = index === 1 ? this.file : `${this.file}.${index - 1}`;
        if (existsSync(source)) renameSync(source, `${this.file}.${index}`);
      }
    }
    appendFileSync(this.file, line);
  }
}

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields, error?: unknown) => void;
};

export function createLogger(config: ReelConfig): Logger {
  mkdirSync(config.logDir, { recursive: true });
  const textFile = new RotatingFile(path.join(config.logDir, "app.log"));
  const jsonFile = new RotatingFile(path.join(config.logDir, "app.jsonl"));
  const min = LEVELS[config.logLevel] ?? 20;

  const write = (level: string, msg: string, fields?: LogFields, error?: unknown) => {
    if ((LEVELS[level] ?? 20) < min) return;
    const { json, text } = timestamps();
    const requestId = currentRequestId();
    const safe = fields ? (redact(fields) as LogFields) : undefined;
    const errText =
      error instanceof Error ? `${error.name}: ${redact(error.message)}` : error ? String(redact(error)) : undefined;
    const record = {
      ts: json,
      level,
      msg: redact(msg),
      request_id: requestId,
      ...safe,
      ...(errText ? { error: errText } : {}),
    };
    jsonFile.write(`${JSON.stringify(record)}\n`);
    const extras = safe ? ` ${JSON.stringify(safe)}` : "";
    textFile.write(`${text} ${level} ${requestId} ${msg}${extras}${errText ? ` ${errText}` : ""}\n`);
    if (level === "ERROR") {
      console.error(`${level} ${msg}`);
    } else if (level !== "DEBUG") {
      console.log(`${level} ${msg}`);
    }
  };

  return {
    debug: (message, fields) => write("DEBUG", message, fields),
    info: (message, fields) => write("INFO", message, fields),
    warn: (message, fields) => write("WARNING", message, fields),
    error: (message, fields, error) => write("ERROR", message, fields, error),
  };
}

export function registerRequestLogging(
  app: { addHook: (name: "onRequest" | "onResponse", fn: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) => void },
  log: Logger,
  config: ReelConfig,
) {
  app.addHook("onRequest", async (req) => {
    const id = typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : crypto.randomUUID();
    req.headers["x-request-id"] = id;
    requestContext.enterWith(id);
    log.info(`${req.method} ${req.url}`, {
      method: req.method,
      url: req.url,
      headers: redact(req.headers),
    });
  });

  app.addHook("onResponse", async (req, reply) => {
    log.info(`${req.method} ${req.url} ${reply.statusCode}`, {
      method: req.method,
      url: req.url,
      status: reply.statusCode,
      body_limit: config.logBodyMax,
    });
  });
}
