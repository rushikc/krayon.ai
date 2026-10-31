import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyCuts, normalizeCuts, type Actor, type Cuts } from "./domain/types.js";

export type ProjectStatus = "empty" | "analyzing" | "ready" | "rendering" | "error";

export type PipelineMode = "auto" | "transcript" | "scripted";
export type LastPipeline = "transcript" | "scripted" | null;

export type AnalysisSettings = {
  silenceThreshold: number;
  pad: number;
  similarityThreshold: number;
  snapToAudio: boolean;
  snapSearchSeconds: number;
  scriptMatchThreshold: number;
  scriptConfirmThreshold: number;
  scriptPreferLastTakes: boolean;
  scriptWhisperPrompt: boolean;
};

export const DEFAULT_SETTINGS: AnalysisSettings = {
  silenceThreshold: 0.4,
  pad: 0.05,
  similarityThreshold: 0.7,
  snapToAudio: true,
  snapSearchSeconds: 0.3,
  scriptMatchThreshold: 0.7,
  scriptConfirmThreshold: 0.85,
  scriptPreferLastTakes: true,
  scriptWhisperPrompt: true,
};

export type Meta = {
  slug: string;
  title: string;
  sourcePath: string | null;
  nextClipSeq: number;
  nextGroupSeq: number;
  revision: number;
  head: number;
  status: ProjectStatus;
  statusMessage: string;
  createdAt: string;
  updatedAt: string;
  settings: AnalysisSettings;
  pipeline: PipelineMode;
  lastPipeline: LastPipeline;
  scriptLineCount: number;
  needsRebuild: boolean;
  scriptOriginal: string;
};

export type HistoryEntry = {
  revision: number;
  actor: Actor;
  label: string;
  summary: string;
  at: string;
  cuts: Cuts;
  script?: string | null;
};

const locks = new Map<string, Promise<unknown>>();

export function withLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(slug) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(
    slug,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export function assertSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    throw new Error("Slug must be lowercase letters, numbers, and hyphens");
  }
}

export function projectDir(root: string, slug: string): string {
  assertSlug(slug);
  const dir = path.resolve(root, slug);
  if (!dir.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid project path");
  return dir;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}

function historyPath(dir: string, revision: number): string {
  return path.join(dir, "history", `${String(revision).padStart(4, "0")}.json`);
}

export function normalizeSettings(value: Partial<AnalysisSettings> | undefined): AnalysisSettings {
  return {
    silenceThreshold:
      typeof value?.silenceThreshold === "number" && Number.isFinite(value.silenceThreshold)
        ? value.silenceThreshold
        : DEFAULT_SETTINGS.silenceThreshold,
    pad: typeof value?.pad === "number" && Number.isFinite(value.pad) ? value.pad : DEFAULT_SETTINGS.pad,
    similarityThreshold:
      typeof value?.similarityThreshold === "number" && Number.isFinite(value.similarityThreshold)
        ? value.similarityThreshold
        : DEFAULT_SETTINGS.similarityThreshold,
    snapToAudio: typeof value?.snapToAudio === "boolean" ? value.snapToAudio : DEFAULT_SETTINGS.snapToAudio,
    snapSearchSeconds:
      typeof value?.snapSearchSeconds === "number" && Number.isFinite(value.snapSearchSeconds)
        ? value.snapSearchSeconds
        : DEFAULT_SETTINGS.snapSearchSeconds,
    scriptMatchThreshold:
      typeof value?.scriptMatchThreshold === "number" && Number.isFinite(value.scriptMatchThreshold)
        ? value.scriptMatchThreshold
        : DEFAULT_SETTINGS.scriptMatchThreshold,
    scriptConfirmThreshold:
      typeof value?.scriptConfirmThreshold === "number" && Number.isFinite(value.scriptConfirmThreshold)
        ? value.scriptConfirmThreshold
        : DEFAULT_SETTINGS.scriptConfirmThreshold,
    scriptPreferLastTakes:
      typeof value?.scriptPreferLastTakes === "boolean" ? value.scriptPreferLastTakes : DEFAULT_SETTINGS.scriptPreferLastTakes,
    scriptWhisperPrompt:
      typeof value?.scriptWhisperPrompt === "boolean" ? value.scriptWhisperPrompt : DEFAULT_SETTINGS.scriptWhisperPrompt,
  };
}

export function normalizeScriptText(script: string): string {
  return script
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}

export function countScriptLines(script: string): number {
  return normalizeScriptText(script)
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
}

export function scriptPath(dir: string): string {
  return path.join(dir, "script.txt");
}

export async function readScript(dir: string): Promise<string> {
  try {
    return await readFile(scriptPath(dir), "utf8");
  } catch {
    return "";
  }
}

export async function writeScript(dir: string, script: string): Promise<void> {
  const normalized = normalizeScriptText(script);
  if (!normalized.trim()) {
    await rm(scriptPath(dir), { force: true });
    return;
  }
  await writeFile(scriptPath(dir), normalized.endsWith("\n") ? normalized : `${normalized}\n`);
}

export async function restoreScript(dir: string, script: string | null | undefined): Promise<void> {
  if (script === undefined) return;
  await writeScript(dir, script ?? "");
}

export function resolvedPipeline(meta: Meta, override?: PipelineMode | null): "transcript" | "scripted" {
  const mode = override ?? meta.pipeline ?? "auto";
  if (mode === "transcript") return "transcript";
  if (mode === "scripted") return meta.scriptLineCount > 0 ? "scripted" : "transcript";
  return meta.scriptLineCount > 0 ? "scripted" : "transcript";
}

export function normalizeMeta(meta: Meta): Meta {
  return {
    ...meta,
    settings: normalizeSettings(meta.settings),
    pipeline: meta.pipeline === "transcript" || meta.pipeline === "scripted" ? meta.pipeline : "auto",
    lastPipeline: meta.lastPipeline === "scripted" || meta.lastPipeline === "transcript" ? meta.lastPipeline : null,
    scriptLineCount: typeof meta.scriptLineCount === "number" ? meta.scriptLineCount : 0,
    needsRebuild: Boolean(meta.needsRebuild),
    scriptOriginal: typeof meta.scriptOriginal === "string" ? meta.scriptOriginal : "",
  };
}

export async function readMeta(dir: string): Promise<Meta> {
  const raw = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8")) as Meta;
  return normalizeMeta(raw);
}

export async function readCuts(dir: string): Promise<Cuts> {
  const raw = JSON.parse(await readFile(path.join(dir, "cuts.json"), "utf8")) as Cuts;
  return normalizeCuts(raw);
}

export async function listProjects(root: string): Promise<Meta[]> {
  await mkdir(root, { recursive: true });
  const names = await readdir(root, { withFileTypes: true });
  const metas: Meta[] = [];
  for (const entry of names) {
    if (!entry.isDirectory()) continue;
    try {
      metas.push(await readMeta(path.join(root, entry.name)));
    } catch {
      continue;
    }
  }
  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createProject(root: string, slug: string, title: string, script = ""): Promise<Meta> {
  const dir = projectDir(root, slug);
  await mkdir(path.join(dir, "analysis"), { recursive: true });
  await mkdir(path.join(dir, "history"), { recursive: true });
  await mkdir(path.join(dir, "output"), { recursive: true });
  const normalized = normalizeScriptText(script);
  const now = new Date().toISOString();
  const meta: Meta = {
    slug,
    title,
    sourcePath: null,
    nextClipSeq: 1,
    nextGroupSeq: 1,
    revision: 0,
    head: 0,
    status: "empty",
    statusMessage: "Add a source video",
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_SETTINGS },
    pipeline: "auto",
    lastPipeline: null,
    scriptLineCount: countScriptLines(normalized),
    needsRebuild: false,
    scriptOriginal: normalized,
  };
  await writeJson(path.join(dir, "meta.json"), meta);
  await writeJson(path.join(dir, "cuts.json"), emptyCuts());
  await writeScript(dir, normalized);
  return meta;
}

export async function saveMeta(dir: string, meta: Meta): Promise<void> {
  meta.updatedAt = new Date().toISOString();
  await writeJson(path.join(dir, "meta.json"), meta);
}

export function recoveredStatus(meta: Meta, cuts: Cuts): ProjectStatus {
  if (meta.revision > 0 && cuts.clips.length > 0) return "ready";
  return "error";
}

export async function recoverStuckProjects(
  root: string,
  message = "Interrupted by server restart",
): Promise<number> {
  const projects = await listProjects(root);
  let count = 0;
  for (const meta of projects) {
    if (meta.status !== "analyzing" && meta.status !== "rendering") continue;
    const dir = projectDir(root, meta.slug);
    const cuts = await readCuts(dir);
    meta.status = recoveredStatus(meta, cuts);
    meta.statusMessage = message;
    await saveMeta(dir, meta);
    count += 1;
  }
  return count;
}

export async function resetProjectStatus(dir: string, meta: Meta, cuts: Cuts, message = "Reset by operator"): Promise<Meta> {
  if (meta.status === "analyzing" || meta.status === "rendering") {
    meta.status = recoveredStatus(meta, cuts);
    meta.statusMessage = message;
    await saveMeta(dir, meta);
  }
  return meta;
}

export async function readHistory(dir: string, revision: number): Promise<HistoryEntry> {
  return JSON.parse(await readFile(historyPath(dir, revision), "utf8")) as HistoryEntry;
}

export async function listHistory(dir: string, meta: Meta): Promise<Array<Omit<HistoryEntry, "cuts"> & { current: boolean }>> {
  const entries = [];
  for (let revision = 1; revision <= meta.head; revision += 1) {
    try {
      const entry = await readHistory(dir, revision);
      entries.push({
        revision: entry.revision,
        actor: entry.actor,
        label: entry.label,
        summary: entry.summary,
        at: entry.at,
        current: entry.revision === meta.revision,
      });
    } catch {
      continue;
    }
  }
  return entries;
}

export async function commitRevision(
  dir: string,
  meta: Meta,
  cuts: Cuts,
  actor: Actor,
  label: string,
  summary: string,
): Promise<HistoryEntry> {
  if (meta.revision < meta.head) {
    for (let revision = meta.revision + 1; revision <= meta.head; revision += 1) {
      await rm(historyPath(dir, revision), { force: true });
    }
    meta.head = meta.revision;
  }
  meta.head += 1;
  meta.revision = meta.head;
  cuts.revision = meta.revision;
  const script = await readScript(dir);
  const entry: HistoryEntry = {
    revision: meta.revision,
    actor,
    label,
    summary,
    at: new Date().toISOString(),
    cuts,
    script,
  };
  await mkdir(path.join(dir, "history"), { recursive: true });
  await writeJson(historyPath(dir, entry.revision), entry);
  await writeJson(path.join(dir, "cuts.json"), cuts);
  await saveMeta(dir, meta);
  return entry;
}

export async function moveHistory(dir: string, meta: Meta, direction: "undo" | "redo"): Promise<Cuts> {
  const target = direction === "undo" ? meta.revision - 1 : meta.revision + 1;
  if (direction === "undo" && meta.revision <= 0) throw new Error("Nothing to undo");
  if (direction === "redo" && target > meta.head) {
    throw new Error("Nothing to redo");
  }
  if (target === 0) {
    meta.revision = 0;
    const cuts = emptyCuts();
    await writeJson(path.join(dir, "cuts.json"), cuts);
    await restoreScript(dir, meta.scriptOriginal);
    meta.scriptLineCount = countScriptLines(meta.scriptOriginal);
    await saveMeta(dir, meta);
    return cuts;
  }
  const entry = await readHistory(dir, target);
  meta.revision = target;
  await writeJson(path.join(dir, "cuts.json"), entry.cuts);
  await restoreScript(dir, entry.script);
  if (entry.script !== undefined) {
    meta.scriptLineCount = countScriptLines(entry.script ?? "");
  }
  await saveMeta(dir, meta);
  return entry.cuts;
}

export async function currentFile(root: string): Promise<string | null> {
  try {
    const slug = (await readFile(path.join(root, ".current"), "utf8")).trim();
    return slug || null;
  } catch {
    return null;
  }
}

export async function useProject(root: string, slug: string): Promise<void> {
  assertSlug(slug);
  await writeFile(path.join(root, ".current"), slug);
}
