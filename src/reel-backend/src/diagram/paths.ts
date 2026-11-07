import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export type ReelPaths = {
  reelId: string;
  reelArg: string;
  dir: string;
  skeleton: string;
  script: string;
  words: string;
  states: string;
  review: string;
  status: string;
  statusPrev: string;
};

export class UnsafeReelPathError extends Error {
  constructor(message = "Invalid reel id") {
    super(message);
    this.name = "UnsafeReelPathError";
  }
}

export function normalizeReelArg(reelArg: string): string {
  return reelArg.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

export function assertUnderDiagramsRoot(diagramsDir: string, candidate: string): string {
  const root = path.resolve(diagramsDir);
  const resolved = path.resolve(candidate);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new UnsafeReelPathError();
  }
  return resolved;
}

export function safeReelPaths(diagramsDir: string, reelArg: string): ReelPaths {
  const normalized = normalizeReelArg(reelArg);
  if (!normalized || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new UnsafeReelPathError();
  }
  const paths = reelPaths(diagramsDir, normalized);
  paths.dir = assertUnderDiagramsRoot(diagramsDir, paths.dir);
  return paths;
}

export function reelPaths(diagramsDir: string, reelArg: string): ReelPaths {
  const normalized = normalizeReelArg(reelArg);
  const dir = path.join(diagramsDir, normalized);
  const reelId = path.basename(normalized);
  return {
    reelId,
    reelArg: normalized,
    dir,
    skeleton: path.join(dir, "diagram.skeleton.json"),
    script: path.join(dir, "script.md"),
    words: path.join(dir, "script.words.json"),
    states: path.join(dir, "states"),
    review: path.join(dir, "review"),
    status: path.join(dir, "status.json"),
    statusPrev: path.join(dir, "status.prev.json"),
  };
}

export function cardStatePath(paths: ReelPaths, cardId: string, step: number): string {
  return path.join(paths.states, cardId, `step-${String(step).padStart(2, "0")}.excalidraw`);
}

export function cardPngPath(paths: ReelPaths, cardId: string, step: number): string {
  return path.join(paths.review, cardId, `step-${String(step).padStart(2, "0")}.png`);
}

export function listReelArgs(diagramsDir: string): string[] {
  if (!existsSync(diagramsDir)) return [];
  const found: string[] = [];
  const walk = (rel: string) => {
    const abs = rel ? path.join(diagramsDir, rel) : diagramsDir;
    let entries: string[] = [];
    try {
      entries = readdirSync(abs);
    } catch {
      return;
    }
    if (entries.includes("diagram.skeleton.json") && statSync(path.join(abs, "diagram.skeleton.json")).isFile()) {
      found.push(rel || ".");
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const child = path.join(abs, name);
      if (statSync(child).isDirectory()) walk(rel ? `${rel}/${name}` : name);
    }
  };
  walk("");
  return found.sort();
}

export function repoRelative(repoRoot: string, abs: string): string {
  return path.relative(repoRoot, abs).split(path.sep).join("/");
}
