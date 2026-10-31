import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyCuts, type Actor, type Cuts } from "./domain/types.js";

export type ProjectStatus = "empty" | "analyzing" | "ready" | "rendering" | "error";

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
};

export type HistoryEntry = {
  revision: number;
  actor: Actor;
  label: string;
  summary: string;
  at: string;
  cuts: Cuts;
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

export async function readMeta(dir: string): Promise<Meta> {
  return JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8")) as Meta;
}

export async function readCuts(dir: string): Promise<Cuts> {
  return JSON.parse(await readFile(path.join(dir, "cuts.json"), "utf8")) as Cuts;
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

export async function createProject(root: string, slug: string, title: string): Promise<Meta> {
  const dir = projectDir(root, slug);
  await mkdir(path.join(dir, "analysis"), { recursive: true });
  await mkdir(path.join(dir, "history"), { recursive: true });
  await mkdir(path.join(dir, "output"), { recursive: true });
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
  };
  await writeJson(path.join(dir, "meta.json"), meta);
  await writeJson(path.join(dir, "cuts.json"), emptyCuts());
  return meta;
}

export async function saveMeta(dir: string, meta: Meta): Promise<void> {
  meta.updatedAt = new Date().toISOString();
  await writeJson(path.join(dir, "meta.json"), meta);
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
  const entry: HistoryEntry = {
    revision: meta.revision,
    actor,
    label,
    summary,
    at: new Date().toISOString(),
    cuts,
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
    await saveMeta(dir, meta);
    return cuts;
  }
  const entry = await readHistory(dir, target);
  meta.revision = target;
  await writeJson(path.join(dir, "cuts.json"), entry.cuts);
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
