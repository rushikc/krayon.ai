import os from "node:os";
import path from "node:path";
import type { ReelConfig } from "../src/config.js";
import type { GeminiClient, GenerateJsonRequest } from "../src/gemini.js";
import type { Logger } from "../src/logging.js";
import type { CanvasElement } from "../src/canvas/types.js";

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export function testConfig(dir?: string): ReelConfig {
  const root = dir ?? path.join(os.tmpdir(), `krayon-reel-${crypto.randomUUID()}`);
  return {
    host: "127.0.0.1",
    port: 0,
    corsOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"],
    logLevel: "ERROR",
    logBodyMax: 200,
    gemini: {
      model: "gemini-2.5-flash",
      reviewModel: "gemini-2.5-flash",
      fixModel: "gemini-2.5-flash",
      timeoutMs: 5_000,
      maxConcurrency: 1,
    },
    pipeline: {
      maxRounds: 2,
      passScore: 8,
      maxKeyframes: 4,
      generateAttempts: 3,
    },
    render: { width: 1080, height: 1920 },
    dataDir: path.join(root, "data"),
    logDir: path.join(root, "logs"),
  };
}

export const MINIMAL_SCENE: CanvasElement[] = [
  {
    id: "a",
    type: "box",
    matrix: [2, 4, 15, 7],
    label: "Source",
    colorTheme: "sky",
    time: { start: 0, end: 10, track: 1 },
  },
  {
    id: "b",
    type: "box",
    matrix: [2, 16, 15, 19],
    label: "Target",
    sublabel: "optional second line",
    colorTheme: "green",
    time: { start: 0, end: 10, track: 2 },
  },
  {
    id: "a-to-b",
    type: "arrow",
    sourceId: "a",
    targetId: "b",
    variant: "solid",
    time: { start: 0.5, end: 10, track: 5 },
  },
];

export function envelope(elements: CanvasElement[]) {
  return { elements };
}

export function fakeGemini(handlers: {
  generate?: (req: GenerateJsonRequest) => unknown | Promise<unknown>;
  review?: (req: GenerateJsonRequest) => unknown | Promise<unknown>;
  fix?: (req: GenerateJsonRequest) => unknown | Promise<unknown>;
  repair?: (req: GenerateJsonRequest) => unknown | Promise<unknown>;
}): GeminiClient {
  return {
    async generateJson(req) {
      const fn = handlers[req.callType];
      if (!fn) {
        throw new Error(`unexpected callType ${req.callType}`);
      }
      return fn(req);
    },
  };
}

export function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out");
}
