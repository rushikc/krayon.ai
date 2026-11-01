import fs from "node:fs";
import path from "node:path";

export const API = process.env.E2E_API ?? "http://127.0.0.1:8789/api/studio";
export const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export type ApiClip = {
  id: string;
  status: "selected" | "rejected" | "undecided";
  decidedBy?: string;
  statusReason?: string;
  llm?: Record<string, unknown>;
  parentIds?: string[];
  sourceStart: number;
  sourceEnd: number;
  duration: number;
  text: string;
  groupId: string;
};

export type ApiProject = {
  meta: { slug: string; status: string; sourcePath: string | null; revision: number };
  revision: number;
  clips: ApiClip[];
  order: string[];
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.url} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const studioApi = {
  projects: () => fetch(`${API}/projects`).then((r) => json<{ projects: Array<{ slug: string; status: string; clipCount?: number }> }>(r)),
  project: (slug: string) => fetch(`${API}/projects/${slug}`).then((r) => json<ApiProject>(r)),
  clip: (slug: string, id: string) => fetch(`${API}/projects/${slug}/clips/${id}`).then((r) => json<{ clip: ApiClip }>(r)),
  history: (slug: string) =>
    fetch(`${API}/projects/${slug}/history`).then((r) =>
      json<{ revision: number; history: Array<{ revision: number; label: string; summary: string; current: boolean }> }>(r),
    ),
  undo: (slug: string) => fetch(`${API}/projects/${slug}/undo`, { method: "POST" }).then((r) => json<{ revision: number }>(r)),
  redo: (slug: string) => fetch(`${API}/projects/${slug}/redo`, { method: "POST" }).then((r) => json<{ revision: number }>(r)),
  applyOps: (slug: string, baseRevision: number, ops: unknown[], label = "op") =>
    fetch(`${API}/projects/${slug}/ops`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-krayon-actor": "human" },
      body: JSON.stringify({ baseRevision, ops, label }),
    }).then((r) => json<{ revision: number; summary: string }>(r)),
  updateScript: (slug: string, baseRevision: number, script: string) =>
    fetch(`${API}/projects/${slug}/script`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseRevision, script }),
    }).then((r) => json<{ revision: number; needsRebuild: boolean; scriptLineCount: number }>(r)),
  resetStatus: (slug: string) =>
    fetch(`${API}/projects/${slug}/reset-status`, { method: "POST" }).then((r) => json<{ status: string; statusMessage: string }>(r)),
  importPath: (slug: string, sourcePath: string) =>
    fetch(`${API}/projects/${slug}/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: sourcePath }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.json() as Promise<{ sourcePath: string }>;
    }),
  createProject: (title: string) =>
    fetch(`${API}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((r) => json<{ slug: string }>(r)),
  deleteProject: (slug: string) =>
    fetch(`${API}/projects/${slug}`, { method: "DELETE" }).then((r) => json<{ deleted: string }>(r)),
  health: () => fetch(`${API}/health`).then((r) => json<{ status: string; projectsDir?: string }>(r)),
  async currentRevision(slug: string) {
    const h = await studioApi.history(slug);
    return h.history.find((entry) => entry.current)?.revision ?? 0;
  },
  /** Undo until the project is back at `revision`. Keeps tests from leaving edits in your data. */
  async rollbackTo(slug: string, revision: number) {
    for (let i = 0; i < 12; i += 1) {
      if ((await studioApi.currentRevision(slug)) <= revision) return;
      await studioApi.undo(slug);
    }
  },
};

/** The project the UI tests run against. Edits are always rolled back with undo. */
export async function pickProject(): Promise<string | null> {
  const wanted = process.env.E2E_PROJECT;
  const { projects } = await studioApi.projects();
  const ready = projects.filter((p) => p.status === "ready");
  if (wanted) return projects.some((p) => p.slug === wanted) ? wanted : null;
  for (const slug of ["test1", "real"]) {
    if (ready.some((p) => p.slug === slug)) return slug;
  }
  return ready[0]?.slug ?? null;
}

export function removeProjectFolder(slug: string) {
  if (!/^e2e-[a-z0-9-]+$/.test(slug)) throw new Error(`Refusing to delete non-test project ${slug}`);
  fs.rmSync(path.join(REPO_ROOT, "studio", slug), { recursive: true, force: true });
}
