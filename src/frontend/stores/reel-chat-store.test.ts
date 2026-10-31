import { beforeEach, describe, expect, it, vi } from "vitest";

import { setGeminiApiKey } from "@/lib/gemini-key";
import { persistThreadJobIds, REEL_THREAD_IDS_STORAGE_KEY } from "@/lib/reel-chat-settings";
import { useCanvasStore } from "@/stores/canvas-store";
import { useReelChatStore } from "@/stores/reel-chat-store";
import type { JobState } from "@/types/reel-pipeline";

vi.mock("@/lib/api/reel-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/reel-client")>();
  return {
    ...actual,
    health: vi.fn().mockResolvedValue({ ok: true, service: "reel-backend" }),
    createJob: vi.fn(),
    refineJob: vi.fn(),
    getJob: vi.fn(),
    cancelJob: vi.fn(),
    listJobs: vi.fn().mockResolvedValue([]),
    subscribeToJob: vi.fn(() => () => undefined),
  };
});

import * as reelClient from "@/lib/api/reel-client";

const scene = [
  {
    id: "client",
    type: "box" as const,
    matrix: [2, 1, 15, 3] as const,
    label: "Applied box",
    colorTheme: "sky" as const,
    time: { start: 0, end: 5, track: 0 },
  },
];

function job(overrides: Partial<JobState> = {}): JobState {
  return {
    id: "job-1",
    status: "queued",
    script: "teach rest",
    maxRounds: 2,
    passScore: 8,
    models: { generate: "g", review: "r", fix: "f" },
    progress: { phase: "queued", message: "queued", round: 0, ratio: 0 },
    rounds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.removeItem(REEL_THREAD_IDS_STORAGE_KEY);
  persistThreadJobIds([]);
  setGeminiApiKey("test-key");
  useCanvasStore.getState().reset();
  useReelChatStore.setState({
    healthOk: true,
    jobIds: [],
    jobsById: {},
    historyJobs: [],
    keyDialogOpen: false,
    pendingSend: null,
    hydrating: false,
  });
  vi.mocked(reelClient.createJob).mockReset();
  vi.mocked(reelClient.refineJob).mockReset();
  vi.mocked(reelClient.getJob).mockReset();
  vi.mocked(reelClient.cancelJob).mockReset();
  vi.mocked(reelClient.subscribeToJob).mockClear();
});

describe("reel chat store", () => {
  it("creates a job for the first script", async () => {
    vi.mocked(reelClient.createJob).mockResolvedValue({ jobId: "job-1" });
    vi.mocked(reelClient.getJob).mockResolvedValue(job());
    await useReelChatStore.getState().send("teach rest");
    expect(reelClient.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ script: "teach rest" }),
    );
    expect(reelClient.refineJob).not.toHaveBeenCalled();
    expect(useReelChatStore.getState().jobIds).toEqual(["job-1"]);
    expect(reelClient.subscribeToJob).toHaveBeenCalled();
  });

  it("refines from a completed job", async () => {
    const done = job({
      status: "done",
      result: { scene, scores: { clarity: 9, readability: 9, accuracy: 9, overall: 9 }, round: 1 },
      rounds: [
        {
          n: 1,
          scene,
          scores: { clarity: 9, readability: 9, accuracy: 9, overall: 9 },
          pass: true,
          issues: [],
          keyframes: [],
        },
      ],
    });
    useReelChatStore.setState({
      jobIds: ["job-1"],
      jobsById: { "job-1": done },
    });
    vi.mocked(reelClient.refineJob).mockResolvedValue({
      jobId: "job-2",
      parentJobId: "job-1",
    });
    vi.mocked(reelClient.getJob).mockResolvedValue(
      job({
        id: "job-2",
        parentJobId: "job-1",
        refineInstructions: "bigger labels",
      }),
    );
    await useReelChatStore.getState().send("bigger labels");
    expect(reelClient.refineJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ instructions: "bigger labels" }),
    );
    expect(reelClient.createJob).not.toHaveBeenCalled();
  });

  it("cancels the running job", async () => {
    useReelChatStore.setState({
      jobIds: ["job-1"],
      jobsById: { "job-1": job({ status: "running" }) },
    });
    vi.mocked(reelClient.cancelJob).mockResolvedValue({ ok: true });
    await useReelChatStore.getState().cancelActive();
    expect(reelClient.cancelJob).toHaveBeenCalledWith("job-1");
  });

  it("applies a round through parse validation and undo history", () => {
    const done = job({
      status: "done",
      result: { scene, scores: null, round: 1 },
      rounds: [
        {
          n: 1,
          scene,
          scores: null,
          pass: true,
          issues: [],
          keyframes: [],
        },
      ],
    });
    useReelChatStore.setState({
      jobIds: ["job-1"],
      jobsById: { "job-1": done },
    });
    const before = useCanvasStore.getState().elements;
    expect(useReelChatStore.getState().applyRound("job-1", 1)).toBe(true);
    expect(useCanvasStore.getState().elements[0]).toMatchObject({
      id: "client",
      type: "box",
    });
    expect(useCanvasStore.getState().selectedId).toBeNull();
    expect(useCanvasStore.getState().currentTime).toBe(0);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().elements).toEqual(before);
  });

  it("rejects invalid scene JSON", () => {
    useReelChatStore.setState({
      jobIds: ["job-1"],
      jobsById: {
        "job-1": job({
          status: "done",
          rounds: [
            {
              n: 1,
              scene: [{ id: "bad" } as never],
              scores: null,
              pass: null,
              issues: [],
              keyframes: [],
            },
          ],
        }),
      },
    });
    const before = useCanvasStore.getState().elements;
    expect(useReelChatStore.getState().applyRound("job-1", 1)).toBe(false);
    expect(useCanvasStore.getState().elements).toEqual(before);
  });
});
