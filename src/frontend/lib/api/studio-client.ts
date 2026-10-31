const API = "/api/studio";

export type Actor = "algorithm" | "grok" | "human";

export type StudioClip = {
  id: string;
  parentIds: string[];
  sourceStart: number;
  sourceEnd: number;
  ranges: { sourceStart: number; sourceEnd: number }[];
  duration: number;
  text: string;
  words: { text: string; start: number; end: number }[];
  wordCount?: number;
  groupId: string;
  label: string;
  score: number;
  reasons: string[];
  status: "selected" | "rejected" | "undecided";
  decidedBy: Actor;
  note: string;
};

export type StudioGroup = {
  id: string;
  label: string;
  clipIds: string[];
  recommendedClipId: string | null;
};

export type HistoryItem = {
  revision: number;
  actor: Actor;
  label: string;
  summary: string;
  at: string;
  current: boolean;
};

export type StudioProject = {
  meta: {
    slug: string;
    title: string;
    sourcePath: string | null;
    revision: number;
    status: string;
    statusMessage: string;
  };
  revision: number;
  status: string;
  clips: StudioClip[];
  groups: StudioGroup[];
  order: string[];
  history: HistoryItem[];
};

export type StudioOp = Record<string, unknown>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-krayon-actor": "human",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = payload.message ?? payload.detail ?? response.statusText;
    throw new Error(typeof message === "string" ? message : "Request failed");
  }
  return payload as T;
}

export function listProjects() {
  return request<{ projects: StudioProject["meta"][]; current: string | null }>("/projects");
}

export function createProject(title: string) {
  return request<StudioProject["meta"]>("/projects", { method: "POST", body: JSON.stringify({ title }) });
}

export function getProject(slug: string) {
  return request<StudioProject>(`/projects/${slug}`);
}

export function importPath(slug: string, sourcePath: string) {
  return request<{ sourcePath: string }>(`/projects/${slug}/import`, {
    method: "POST",
    body: JSON.stringify({ path: sourcePath }),
  });
}

export async function importFile(slug: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API}/projects/${slug}/import`, {
    method: "POST",
    headers: { "x-krayon-actor": "human" },
    body,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ sourcePath: string }>;
}

export function pickFile() {
  return request<{ path: string | null; cancelled: boolean }>("/pick-file", { method: "POST", body: "{}" });
}

export function analyze(slug: string, baseRevision: number) {
  return request<{ revision: number; clipCount: number }>(`/projects/${slug}/analyze`, {
    method: "POST",
    body: JSON.stringify({ baseRevision }),
  });
}

export function applyOps(slug: string, baseRevision: number, ops: StudioOp[], label?: string) {
  return request<{ revision: number; summary: string; order: string[] }>(`/projects/${slug}/ops`, {
    method: "POST",
    body: JSON.stringify({ baseRevision, actor: "human", label, ops }),
  });
}

export function reanalyze(slug: string, baseRevision: number, body: Record<string, unknown>) {
  return request(`/projects/${slug}/reanalyze`, {
    method: "POST",
    body: JSON.stringify({ baseRevision, actor: "human", ...body }),
  });
}

export function undo(slug: string) {
  return request<{ revision: number }>(`/projects/${slug}/undo`, { method: "POST", body: "{}" });
}

export function redo(slug: string) {
  return request<{ revision: number }>(`/projects/${slug}/redo`, { method: "POST", body: "{}" });
}

export function restore(slug: string, revision: number) {
  return request(`/projects/${slug}/restore`, { method: "POST", body: JSON.stringify({ revision, actor: "human" }) });
}

export function lintProject(slug: string) {
  return request<{ warnings: { code: string; message: string; clipId?: string }[] }>(`/projects/${slug}/lint`);
}

export function startRender(slug: string, quality: "preview" | "final") {
  return request<{ renderId: string; outputName: string }>(`/projects/${slug}/render`, {
    method: "POST",
    body: JSON.stringify({ quality }),
  });
}

export function renderStatus(slug: string, id: string) {
  return request<{ status: string; ratio: number; message: string; outputName?: string }>(`/projects/${slug}/render/${id}`);
}

export function sourceUrl(slug: string) {
  return `${API}/projects/${slug}/media/source`;
}

export function outputUrl(slug: string, name: string) {
  return `${API}/projects/${slug}/media/output/${encodeURIComponent(name)}`;
}

export function eventsUrl(slug: string) {
  return `${API}/projects/${slug}/events`;
}

export function audioUrl(slug: string, id: string, pad = 0.5) {
  return `${API}/projects/${slug}/clips/${id}/audio.wav?pad=${pad}`;
}
