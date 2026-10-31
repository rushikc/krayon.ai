import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, createJob, refineJob, subscribeToJob } from "@/lib/api/reel-client";
import { setGeminiApiKey, clearGeminiApiKey } from "@/lib/gemini-key";
import type { ErrorCode, JobState, ReelEvent } from "@/types/reel-pipeline";
import { friendlyErrorMessage, isErrorCode } from "@/types/reel-pipeline";

const ALL_CODES: ErrorCode[] = [
  "UNAUTHORIZED",
  "BAD_API_KEY",
  "BAD_REQUEST",
  "NOT_FOUND",
  "CONFLICT",
  "SCHEMA_INVALID",
  "NOT_JSON",
  "RATE_LIMITED",
  "QUOTA",
  "MAX_TOKENS",
  "SAFETY_BLOCKED",
  "TIMEOUT",
  "CANCELLED",
  "UPSTREAM",
];

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  document.cookie = "krayon_gemini_api_key=; Path=/; Max-Age=0; SameSite=Strict";
  setGeminiApiKey("test-key");
});

afterEach(() => {
  clearGeminiApiKey();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reel-client", () => {
  it("sends X-Gemini-Api-Key on create", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ jobId: "abc" }, 202));
    vi.stubGlobal("fetch", fetchMock);
    await createJob({ script: "hello" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/reel/jobs");
    const headers = new Headers(init.headers);
    expect(headers.get("X-Gemini-Api-Key")).toBe("test-key");
    expect(String(init.body)).not.toContain("test-key");
  });

  it("sends X-Gemini-Api-Key on refine", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ jobId: "child", parentJobId: "parent" }, 202));
    vi.stubGlobal("fetch", fetchMock);
    await refineJob("parent", { instructions: "make it clearer" });
    const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get("X-Gemini-Api-Key")).toBe("test-key");
  });

  it("maps every error code to a friendly ApiError", async () => {
    for (const code of ALL_CODES) {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ code, message: "raw" }, 400));
      vi.stubGlobal("fetch", fetchMock);
      await expect(createJob({ script: "x" })).rejects.toMatchObject({
        name: "ApiError",
        code,
        message: friendlyErrorMessage(code, "raw"),
      });
      expect(isErrorCode(code)).toBe(true);
    }
  });

  it("throws UNAUTHORIZED without calling fetch when the key is missing", async () => {
    clearGeminiApiKey();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createJob({ script: "x" })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("subscribeToJob", () => {
  it("applies snapshot, progress, round, and terminal events", () => {
    const instances: FakeEventSource[] = [];
    class FakeEventSource {
      url: string;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: (() => void) | null = null;
      closed = false;
      constructor(url: string) {
        this.url = url;
        instances.push(this);
      }
      close() {
        this.closed = true;
      }
      emit(event: ReelEvent) {
        this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
      }
    }

    const jobs: JobState[] = [];
    const types: string[] = [];
    const job = sampleJob("running");
    const stop = subscribeToJob(
      "job-1",
      {
        onJob: (next) => jobs.push(next),
        onEvent: (event) => types.push(event.type),
      },
      { EventSourceImpl: FakeEventSource as unknown as typeof EventSource },
    );

    expect(instances[0].url).toBe("/api/reel/jobs/job-1/events");
    instances[0].emit({ type: "snapshot", job });
    instances[0].emit({
      type: "progress",
      phase: "generate",
      message: "Writing scene",
      round: 1,
      ratio: 0.2,
    });
    instances[0].emit({ type: "round", round: 1, phase: "review" });
    instances[0].emit({ type: "done", job: { ...job, status: "done" } });

    expect(types).toEqual(["snapshot", "progress", "round", "done"]);
    expect(jobs.some((item) => item.progress.message === "Writing scene")).toBe(true);
    expect(jobs.at(-1)?.status).toBe("done");
    expect(instances[0].closed).toBe(true);
    stop();
  });

  it("closes on error and cancelled", () => {
    const instances: FakeEventSource[] = [];
    class FakeEventSource {
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: (() => void) | null = null;
      closed = false;
      constructor() {
        instances.push(this);
      }
      close() {
        this.closed = true;
      }
      emit(event: ReelEvent) {
        this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
      }
    }

    subscribeToJob(
      "job-2",
      { onJob: () => undefined },
      { EventSourceImpl: FakeEventSource as unknown as typeof EventSource },
    );
    instances[0].emit({ type: "snapshot", job: sampleJob("running") });
    instances[0].emit({ type: "error", code: "TIMEOUT", message: "late" });
    expect(instances[0].closed).toBe(true);

    subscribeToJob(
      "job-3",
      { onJob: () => undefined },
      { EventSourceImpl: FakeEventSource as unknown as typeof EventSource },
    );
    instances[1].emit({ type: "cancelled" });
    expect(instances[1].closed).toBe(true);
  });

  it("falls back to polling when the stream errors", async () => {
    vi.useFakeTimers();
    const instances: FakeEventSource[] = [];
    class FakeEventSource {
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: (() => void) | null = null;
      close() {}
      constructor() {
        instances.push(this);
      }
    }

    const poll = vi
      .fn()
      .mockResolvedValueOnce(sampleJob("running"))
      .mockResolvedValueOnce(sampleJob("done"));
    const seen: string[] = [];
    subscribeToJob(
      "job-4",
      { onJob: (job) => seen.push(job.status) },
      {
        EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
        poll,
        pollIntervalMs: 2000,
      },
    );
    instances[0].onerror?.();
    await vi.runAllTicks();
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(seen).toContain("running");
    expect(seen).toContain("done");
    vi.useRealTimers();
  });
});

function sampleJob(status: JobState["status"]): JobState {
  return {
    id: "job-1",
    status,
    script: "teach this",
    maxRounds: 2,
    passScore: 8,
    models: { generate: "g", review: "r", fix: "f" },
    progress: { phase: "generate", message: "start", round: 1, ratio: 0 },
    rounds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
