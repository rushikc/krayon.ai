import { GoogleGenAI } from "@google/genai";
import { AppError, type ErrorCode } from "./errors.js";
import type { Logger } from "./logging.js";

export type GeminiFile = { data: Uint8Array; mimeType: string };

export type GeminiCallType = "generate" | "review" | "fix" | "repair";

export type GenerateJsonRequest = {
  apiKey: string;
  model: string;
  prompt: string;
  schema: Record<string, unknown>;
  files?: GeminiFile[];
  callType: GeminiCallType;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type GeminiClient = {
  generateJson: (req: GenerateJsonRequest) => Promise<unknown>;
};

const ALLOWED = new Set([
  "type",
  "properties",
  "items",
  "required",
  "description",
  "enum",
  "nullable",
  "format",
  "propertyOrdering",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
]);

export function normalizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map((item) => normalizeSchema(item));
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!ALLOWED.has(key)) continue;
    if (key === "type" && typeof value === "string") out[key] = value.toUpperCase();
    else if (key === "properties" && value && typeof value === "object") {
      const props: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
        props[name] = normalizeSchema(child);
      }
      out[key] = props;
    } else if (key === "items") out[key] = normalizeSchema(value);
    else if (key === "anyOf" && Array.isArray(value)) out[key] = value.map((item) => normalizeSchema(item));
    else out[key] = value;
  }
  return out;
}

const BACKOFF_MS = [4_000, 8_000, 16_000, 32_000];
const RATE_LIMIT_RETRIES = BACKOFF_MS.length;
const MAX_OUTPUT_TOKENS = 8192;
const THINKING: Record<string, number> = { generate: 0, review: 256, fix: 256, repair: 256 };

export type GeminiErrorKind =
  | "rate_limited"
  | "quota"
  | "safety_blocked"
  | "token_limit"
  | "invalid_request"
  | "timeout"
  | "bad_api_key"
  | "unknown";

function errorStatus(error: unknown): number | undefined {
  const record = error as { status?: number; code?: number; response?: { status?: number } };
  return record.status ?? record.code ?? record.response?.status;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function classifyGeminiFailure(error: unknown): GeminiErrorKind {
  const status = errorStatus(error);
  const text = errorText(error);
  if (/MAX_TOKENS/i.test(text)) return "token_limit";
  if (/SAFETY|PROHIBITED_CONTENT|BLOCKLIST|blocked due to safety/i.test(text)) return "safety_blocked";
  if (status === 401 || status === 403 || /API[_ ]?KEY|UNAUTHENTICATED|PERMISSION_DENIED|invalid api key/i.test(text)) {
    return "bad_api_key";
  }
  if (status === 400 || /INVALID_ARGUMENT|invalid argument/i.test(text)) return "invalid_request";
  if (/quota/i.test(text) && (status === 429 || /RESOURCE_EXHAUSTED/i.test(text))) return "quota";
  if (status === 429 || status === 503 || /RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(text)) return "rate_limited";
  if (error instanceof Error && (error.name === "AbortError" || /aborted|timed? ?out|DEADLINE_EXCEEDED/i.test(text))) {
    return "timeout";
  }
  return "unknown";
}

function headerValue(error: unknown, name: string): string | undefined {
  const headers =
    (error as { headers?: { get?: (key: string) => string | undefined } }).headers ??
    (error as { response?: { headers?: { get?: (key: string) => string | undefined } | Record<string, string> } })
      .response?.headers;
  if (!headers) return undefined;
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get: (key: string) => string | undefined }).get(name);
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()];
}

export function retryAfterMs(error: unknown): number | undefined {
  const raw = headerValue(error, "retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return undefined;
  return Math.max(0, when - Date.now());
}

export function backoffMs(attempt: number, random: () => number = Math.random, retryAfter?: number): number {
  if (retryAfter != null) return retryAfter;
  const base = BACKOFF_MS[Math.min(Math.max(attempt, 0), BACKOFF_MS.length - 1)] ?? 32_000;
  return Math.round(base * (1 + (random() * 0.5 - 0.25)));
}

export function geminiKindToCode(kind: GeminiErrorKind): ErrorCode {
  switch (kind) {
    case "bad_api_key":
      return "BAD_API_KEY";
    case "rate_limited":
      return "RATE_LIMITED";
    case "quota":
      return "QUOTA";
    case "token_limit":
      return "MAX_TOKENS";
    case "safety_blocked":
      return "SAFETY_BLOCKED";
    case "timeout":
      return "TIMEOUT";
    case "invalid_request":
      return "BAD_REQUEST";
    default:
      return "UPSTREAM";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createGeminiClient(
  log: Logger,
  options?: { sleep?: (ms: number) => Promise<void>; random?: () => number },
): GeminiClient {
  const wait = options?.sleep ?? sleep;
  const random = options?.random ?? Math.random;

  return {
    async generateJson(req) {
      if (req.signal?.aborted) {
        throw new AppError("CANCELLED", "Job cancelled");
      }
      const genai = new GoogleGenAI({ apiKey: req.apiKey });
      const parts: Array<Record<string, unknown>> = [];
      for (const file of req.files ?? []) {
        parts.push({
          inlineData: {
            mimeType: file.mimeType || "application/octet-stream",
            data: Buffer.from(file.data).toString("base64"),
          },
        });
      }
      parts.push({ text: req.prompt });

      let last = new AppError("UPSTREAM", "Gemini call failed");
      for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
        if (req.signal?.aborted) {
          throw new AppError("CANCELLED", "Job cancelled");
        }
        const started = performance.now();
        try {
          const controller = new AbortController();
          const onAbort = () => controller.abort();
          req.signal?.addEventListener("abort", onAbort);
          const timer = setTimeout(() => controller.abort(), req.timeoutMs);
          try {
            const result = await genai.models.generateContent({
              model: req.model,
              contents: [{ role: "user", parts }],
              config: {
                responseMimeType: "application/json",
                responseSchema: normalizeSchema(req.schema) as never,
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                abortSignal: controller.signal,
                thinkingConfig: req.model.toLowerCase().includes("flash")
                  ? { thinkingBudget: THINKING[req.callType] ?? 0 }
                  : undefined,
              },
            });
            const finish = String(result.candidates?.[0]?.finishReason ?? "");
            const usage = result.usageMetadata;
            log.info(`Gemini ${req.model} ${req.callType}`, {
              event: "gemini",
              model: req.model,
              call_type: req.callType,
              attempt: attempt + 1,
              call_ms: Math.round(performance.now() - started),
              finish_reason: finish || undefined,
              usage: usage
                ? {
                    prompt: usage.promptTokenCount,
                    output: usage.candidatesTokenCount,
                    total: usage.totalTokenCount,
                  }
                : undefined,
            });
            if (finish === "MAX_TOKENS" || finish === "length") {
              throw new AppError("MAX_TOKENS", "MAX_TOKENS");
            }
            if (/SAFETY|PROHIBITED/i.test(finish)) {
              throw new AppError("SAFETY_BLOCKED", `Gemini finishReason ${finish}`);
            }
            const text = result.text ?? "";
            if (!text.trim()) {
              throw new AppError("NOT_JSON", "Gemini returned empty JSON");
            }
            try {
              return JSON.parse(text) as unknown;
            } catch {
              throw new AppError("NOT_JSON", "Gemini returned malformed JSON");
            }
          } finally {
            clearTimeout(timer);
            req.signal?.removeEventListener("abort", onAbort);
          }
        } catch (error) {
          if (error instanceof AppError) {
            if (error.code === "CANCELLED" || error.code === "MAX_TOKENS" || error.code === "SAFETY_BLOCKED" || error.code === "NOT_JSON") {
              throw error;
            }
            last = error;
            if (error.code !== "RATE_LIMITED" && error.code !== "QUOTA") throw error;
            if (attempt === RATE_LIMIT_RETRIES) throw error;
            await wait(backoffMs(attempt, random, retryAfterMs(error)));
            continue;
          }
          if (req.signal?.aborted) {
            throw new AppError("CANCELLED", "Job cancelled");
          }
          const kind = classifyGeminiFailure(error);
          const message = error instanceof Error ? error.message : String(error);
          last = new AppError(geminiKindToCode(kind), message, undefined, { cause: error });
          log.error(`Gemini ${req.model} failed`, { event: "gemini", call_type: req.callType, error_kind: kind }, last);
          if ((kind !== "rate_limited" && kind !== "quota") || attempt === RATE_LIMIT_RETRIES) {
            throw last;
          }
          await wait(backoffMs(attempt, random, retryAfterMs(error)));
        }
      }
      throw last;
    },
  };
}
