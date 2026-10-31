import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const here = path.dirname(fileURLToPath(import.meta.url));
export const packageRoot = path.resolve(here, "..");
export const repoRoot = path.resolve(packageRoot, "../..");

export type StudioConfig = {
  host: string;
  port: number;
  corsOrigins: string[];
  pythonBase: string;
  projectsDir: string;
};

type TomlShape = {
  host?: string;
  port?: number;
  cors_origins?: string[];
  python_base?: string;
  projects_dir?: string;
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

export function loadConfig(): StudioConfig {
  const tomlPath = path.join(packageRoot, "krayon-studio.toml");
  const toml = existsSync(tomlPath) ? (parseToml(readFileSync(tomlPath, "utf8")) as TomlShape) : {};
  const projects = env("KRAYON_STUDIO_ROOT") ?? toml.projects_dir ?? path.join(repoRoot, "studio");
  return {
    host: env("KRAYON_STUDIO_HOST") ?? toml.host ?? "127.0.0.1",
    port: Number(env("KRAYON_STUDIO_PORT") ?? toml.port ?? 8789),
    corsOrigins: env("KRAYON_STUDIO_CORS_ORIGINS")?.split(",") ??
      toml.cors_origins ?? ["http://localhost:5173", "http://127.0.0.1:5173"],
    pythonBase: env("KRAYON_STUDIO_PYTHON") ?? toml.python_base ?? "http://127.0.0.1:8000",
    projectsDir: path.resolve(projects),
  };
}
