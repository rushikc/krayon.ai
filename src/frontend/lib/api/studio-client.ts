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
  statusReason?: string;
  statusAt?: string;
  note: string;
  llm?: Record<string, unknown>;
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
    settings?: StudioSettings;
  };
  revision: number;
  status: string;
  hasTranscript?: boolean;
  clips: StudioClip[];
  groups: StudioGroup[];
  order: string[];
  history: HistoryItem[];
};

export type StudioSettings = {
  silenceThreshold: number;
  pad: number;
  similarityThreshold: number;
  snapToAudio?: boolean;
  snapSearchSeconds?: number;
};

export type StudioOp = Record<string, unknown>;

export class StudioConflictError extends Error {
  status = 409;
  currentRevision?: number;

  constructor(message: string, currentRevision?: number) {
    super(message);
    this.name = "StudioConflictError";
    this.currentRevision = currentRevision;
  }
}

export type ConfirmationOption = {
  id: string;
  label: string;
  style?: "primary" | "danger" | "default";
  applyOps?: boolean;
};

export type ConfirmationItem = {
  id: string;
  seq: number;
  kind: "confirm" | "choice";
  title: string;
  message: string;
  clipIds: string[];
  options: ConfirmationOption[];
  defaultOptionId: string | null;
  proposedOps: { baseRevision: number; ops: StudioOp[] } | null;
  allowNote: boolean;
  status: "pending" | "answered" | "expired" | "cancelled" | "stale";
  answer: { optionId: string; note: string; by: Actor; at: string } | null;
  result: { applied: boolean; revision: number | null; error: string | null } | null;
  createdBy: Actor;
  createdAt: string;
  expiresAt: string | null;
};

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
    const textMessage = typeof message === "string" ? message : "Request failed";
    if (response.status === 409) {
      throw new StudioConflictError(textMessage, payload.currentRevision);
    }
    throw new Error(textMessage);
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

export function getSettings(slug: string) {
  return request<{ settings: StudioSettings }>(`/projects/${slug}/settings`);
}

export function updateSettings(slug: string, settings: Partial<StudioSettings>) {
  return request<{ settings: StudioSettings }>(`/projects/${slug}/settings`, {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function listSegments(slug: string) {
  return request<{
    sourceDuration: number;
    segments: Array<{
      kind: "speech" | "silence";
      sourceStart: number;
      sourceEnd: number;
      duration: number;
      text: string;
      clipId: string | null;
      status: string | null;
    }>;
  }>(`/projects/${slug}/segments`);
}

export function getTranscript(slug: string) {
  return request<{ words: Array<{ text: string; start: number; end: number; clipId: string | null }> }>(
    `/projects/${slug}/transcript`,
  );
}

export function listOutputs(slug: string) {
  return request<{
    files: string[];
    manifests: Array<{
      name: string;
      quality?: string;
      duration?: number;
      size?: number;
      createdAt?: string | null;
      outputPath?: string;
    }>;
  }>(`/projects/${slug}/output`);
}

export function cancelRender(slug: string, id: string) {
  return request<{ id: string; status: string }>(`/projects/${slug}/render/${id}/cancel`, {
    method: "POST",
    body: "{}",
  });
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

export function peaksUrl(slug: string, id: string, buckets = 800, pad?: number) {
  const params = new URLSearchParams({ buckets: String(buckets) });
  if (pad != null) params.set("pad", String(pad));
  return `${API}/projects/${slug}/clips/${id}/peaks?${params.toString()}`;
}

export function getClipPeaks(slug: string, id: string, buckets = 800, pad?: number) {
  return request<{ duration: number; peaks: number[] }>(
    `/projects/${slug}/clips/${id}/peaks?${new URLSearchParams({
      buckets: String(buckets),
      ...(pad != null ? { pad: String(pad) } : {}),
    }).toString()}`,
  );
}

export function listConfirmations(slug: string, status: "pending" | "answered" | "all" = "all") {
  return request<{ items: ConfirmationItem[] }>(`/projects/${slug}/confirmations?status=${status}`);
}

export function answerConfirmation(slug: string, id: string, optionId: string, note?: string) {
  return request<ConfirmationItem>(`/projects/${slug}/confirmations/${id}/answer`, {
    method: "POST",
    body: JSON.stringify({ optionId, note, actor: "human" }),
  });
}
