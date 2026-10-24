import { describe, expect, it } from "vitest";

import { applyReelEvent, isTerminalReelEvent } from "@/lib/reel-job-reducer";
import type { JobState } from "@/types/reel-pipeline";

function job(overrides: Partial<JobState> = {}): JobState {
  return {
    id: "1",
    status: "running",
    script: "script",
    maxRounds: 2,
    passScore: 8,
    models: { generate: "g", review: "r", fix: "f" },
    progress: { phase: "generate", message: "go", round: 1, ratio: 0.1 },
    rounds: [],
    createdAt: "t0",
    updatedAt: "t1",
    ...overrides,
  };
}

describe("applyReelEvent", () => {
  it("replaces state on snapshot and done", () => {
    const next = job({ status: "done", id: "2" });
    expect(applyReelEvent(null, { type: "snapshot", job: next })?.id).toBe("2");
    expect(applyReelEvent(job(), { type: "done", job: next })?.status).toBe("done");
  });

  it("patches progress and round", () => {
    const progressed = applyReelEvent(job({ status: "queued" }), {
      type: "progress",
      phase: "render",
      message: "pngs",
      round: 1,
      ratio: 0.4,
    });
    expect(progressed?.status).toBe("running");
    expect(progressed?.progress).toEqual({
      phase: "render",
      message: "pngs",
      round: 1,
      ratio: 0.4,
    });
    const rounded = applyReelEvent(progressed, {
      type: "round",
      round: 2,
      phase: "fix",
    });
    expect(rounded?.progress.phase).toBe("fix");
    expect(rounded?.progress.round).toBe(2);
    expect(rounded?.progress.message).toBe("pngs");
  });

  it("marks error and cancelled", () => {
    const errored = applyReelEvent(job(), {
      type: "error",
      code: "TIMEOUT",
      message: "late",
    });
    expect(errored?.status).toBe("error");
    expect(errored?.error).toEqual({ code: "TIMEOUT", message: "late" });
    const cancelled = applyReelEvent(job(), { type: "cancelled" });
    expect(cancelled?.status).toBe("cancelled");
    expect(isTerminalReelEvent({ type: "cancelled" })).toBe(true);
    expect(isTerminalReelEvent({ type: "progress", phase: "x", message: "", round: 1, ratio: 0 })).toBe(
      false,
    );
  });
});
