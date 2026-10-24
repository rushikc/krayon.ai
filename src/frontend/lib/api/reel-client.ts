import { getGeminiApiKey } from "@/lib/gemini-key";
import { applyReelEvent, isTerminalReelEvent } from "@/lib/reel-job-reducer";
import {
  friendlyErrorMessage,
  isErrorCode,
  isTerminalJobStatus,
  type CreateJobBody,
  type ErrorCode,
  type JobState,
  type JobSummary,
  type ReelEvent,
  type RefineJobBody,
} from "@/types/reel-pipeline";

const API_BASE = "/api/reel";
const POLL_MS = 2000;

export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(friendlyErrorMessage(code, message));
    this.name = "ApiError";
    this.code = code;
  }
}

function parseErrorBody(text: string, status: number): ApiError {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === "object" &&
      "code" in parsed &&
      typeof (parsed as { code: unknown }).code === "string"
    ) {
      const code = (parsed as { code: string }).code;
      const message =
        "message" in parsed && typeof (parsed as { message: unknown }).message === "string"
          ? (parsed as { message: string }).message
          : undefined;
      if (isErrorCode(code)) {
        return new ApiError(code, message);
      }
    }
  } catch {
    // not JSON
  }
  if (status === 401) {
    return new ApiError("UNAUTHORIZED");
  }
  return new ApiError("UPSTREAM", text || undefined);
}

async function request<T>(
  path: string,
  init?: RequestInit & { apiKey?: string | null },
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.apiKey) {
    headers.set("X-Gemini-Api-Key", init.apiKey);
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw parseErrorBody(text, res.status);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

function requireKey(): string {
  const key = getGeminiApiKey();
  if (!key) {
    throw new ApiError("UNAUTHORIZED");
  }
  return key;
}

export async function health(): Promise<{ ok: boolean; service: string }> {
  return request("/health");
}

export async function createJob(body: CreateJobBody): Promise<{ jobId: string }> {
  const apiKey = requireKey();
  return request("/jobs", {
    method: "POST",
    body: JSON.stringify(body),
    apiKey,
  });
}

export async function listJobs(): Promise<JobSummary[]> {
  const data = await request<{ jobs: JobSummary[] }>("/jobs");
  return data.jobs;
}

export async function getJob(id: string): Promise<JobState> {
  return request(`/jobs/${id}`);
}

export async function cancelJob(id: string): Promise<{ ok: true }> {
  return request(`/jobs/${id}/cancel`, { method: "POST" });
}

export async function refineJob(
  id: string,
  body: RefineJobBody,
): Promise<{ jobId: string; parentJobId: string }> {
  const apiKey = requireKey();
  return request(`/jobs/${id}/refine`, {
    method: "POST",
    body: JSON.stringify(body),
    apiKey,
  });
}

export function imageUrl(jobId: string, round: number, index: number): string {
  return `${API_BASE}/jobs/${jobId}/rounds/${round}/images/${index}`;
}

export type ReelEventHandlers = {
  onJob: (job: JobState) => void;
  onEvent?: (event: ReelEvent) => void;
};

export type SubscribeOptions = {
  EventSourceImpl?: typeof EventSource;
  poll?: (id: string) => Promise<JobState>;
  pollIntervalMs?: number;
};

function parseReelEvent(data: string): ReelEvent | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (
      parsed &&
      typeof parsed === "object" &&
      "type" in parsed &&
      typeof (parsed as { type: unknown }).type === "string"
    ) {
      return parsed as ReelEvent;
    }
  } catch {
    return null;
  }
  return null;
}

export function subscribeToJob(
  id: string,
  handlers: ReelEventHandlers,
  options: SubscribeOptions = {},
): () => void {
  const EventSourceImpl = options.EventSourceImpl ?? EventSource;
  const pollFn = options.poll ?? getJob;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_MS;
  let closed = false;
  let source: EventSource | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let job: JobState | null = null;

  const stop = () => {
    closed = true;
    source?.close();
    source = null;
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const apply = (event: ReelEvent) => {
    handlers.onEvent?.(event);
    job = applyReelEvent(job, event);
    if (job) {
      handlers.onJob(job);
    }
    if (isTerminalReelEvent(event)) {
      stop();
    }
  };

  const startPolling = () => {
    if (closed) {
      return;
    }
    source?.close();
    source = null;
    const tick = async () => {
      if (closed) {
        return;
      }
      try {
        const next = await pollFn(id);
        job = next;
        handlers.onJob(next);
        if (isTerminalJobStatus(next.status)) {
          stop();
          return;
        }
      } catch {
        // keep polling until the page unloads or the job ends
      }
      if (!closed) {
        pollTimer = setTimeout(() => {
          void tick();
        }, pollIntervalMs);
      }
    };
    void tick();
  };

  try {
    source = new EventSourceImpl(`${API_BASE}/jobs/${id}/events`);
  } catch {
    startPolling();
    return stop;
  }

  source.onmessage = (event: MessageEvent<string>) => {
    if (closed) {
      return;
    }
    const parsed = parseReelEvent(event.data);
    if (!parsed) {
      return;
    }
    apply(parsed);
  };

  source.onerror = () => {
    if (closed) {
      return;
    }
    startPolling();
  };

  return stop;
}
