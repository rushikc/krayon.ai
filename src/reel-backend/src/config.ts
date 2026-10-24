import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const here = path.dirname(fileURLToPath(import.meta.url));
export const packageRoot = path.resolve(here, "..");

export type ReelConfig = {
  host: string;
  port: number;
  corsOrigins: string[];
  logLevel: string;
  logBodyMax: number;
  gemini: {
    model: string;
    reviewModel: string;
    fixModel: string;
    timeoutMs: number;
    maxConcurrency: number;
  };
  pipeline: {
    maxRounds: number;
    passScore: number;
    maxKeyframes: number;
    generateAttempts: number;
  };
  render: {
    width: number;
    height: number;
  };
  dataDir: string;
  logDir: string;
};

type TomlShape = {
  host?: string;
  port?: number;
  cors_origins?: string[];
  log_level?: string;
  log_body_max?: number;
  gemini?: {
    model?: string;
    review_model?: string;
    fix_model?: string;
    timeout_ms?: number;
    max_concurrency?: number;
  };
  pipeline?: {
    max_rounds?: number;
    pass_score?: number;
    max_keyframes?: number;
    generate_attempts?: number;
  };
  render?: {
    width?: number;
    height?: number;
  };
  paths?: {
    data?: string;
    logs?: string;
  };
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

function envInt(name: string): number | undefined {
  const raw = env(name);
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function envList(name: string): string[] | undefined {
  const raw = env(name);
  if (raw == null) return undefined;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveDir(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(packageRoot, value);
}

export function loadConfig(tomlPath = path.join(packageRoot, "krayon-reel.toml")): ReelConfig {
  let toml: TomlShape = {};
  if (existsSync(tomlPath)) {
    toml = parseToml(readFileSync(tomlPath, "utf8")) as TomlShape;
  }

  const dataRel = env("KRAYON_REEL_DATA_DIR") ?? toml.paths?.data ?? "data";
  const logsRel = env("KRAYON_REEL_LOG_DIR") ?? toml.paths?.logs ?? "logs";

  return {
    host: env("KRAYON_REEL_HOST") ?? toml.host ?? "127.0.0.1",
    port: envInt("KRAYON_REEL_PORT") ?? toml.port ?? 8788,
    corsOrigins:
      envList("KRAYON_REEL_CORS_ORIGINS") ??
      toml.cors_origins ?? ["http://localhost:5173", "http://127.0.0.1:5173"],
    logLevel: (env("KRAYON_REEL_LOG_LEVEL") ?? toml.log_level ?? "INFO").toUpperCase(),
    logBodyMax: envInt("KRAYON_REEL_LOG_BODY_MAX") ?? toml.log_body_max ?? 2000,
    gemini: {
      model: env("KRAYON_REEL_GEMINI_MODEL") ?? toml.gemini?.model ?? "gemini-2.5-flash",
      reviewModel:
        env("KRAYON_REEL_GEMINI_REVIEW_MODEL") ??
        toml.gemini?.review_model ??
        toml.gemini?.model ??
        "gemini-2.5-flash",
      fixModel:
        env("KRAYON_REEL_GEMINI_FIX_MODEL") ??
        toml.gemini?.fix_model ??
        toml.gemini?.model ??
        "gemini-2.5-flash",
      timeoutMs: envInt("KRAYON_REEL_GEMINI_TIMEOUT_MS") ?? toml.gemini?.timeout_ms ?? 90_000,
      maxConcurrency:
        envInt("KRAYON_REEL_GEMINI_MAX_CONCURRENCY") ?? toml.gemini?.max_concurrency ?? 5,
    },
    pipeline: {
      maxRounds: envInt("KRAYON_REEL_MAX_ROUNDS") ?? toml.pipeline?.max_rounds ?? 2,
      passScore: envInt("KRAYON_REEL_PASS_SCORE") ?? toml.pipeline?.pass_score ?? 8,
      maxKeyframes: envInt("KRAYON_REEL_MAX_KEYFRAMES") ?? toml.pipeline?.max_keyframes ?? 8,
      generateAttempts:
        envInt("KRAYON_REEL_GENERATE_ATTEMPTS") ?? toml.pipeline?.generate_attempts ?? 3,
    },
    render: {
      width: envInt("KRAYON_REEL_RENDER_WIDTH") ?? toml.render?.width ?? 1080,
      height: envInt("KRAYON_REEL_RENDER_HEIGHT") ?? toml.render?.height ?? 1920,
    },
    dataDir: resolveDir(dataRel),
    logDir: resolveDir(logsRel),
  };
}
