import { describe, expect, it } from "vitest";

import {
  clipMatchesFilter,
  cycleStatusFilter,
  playheadToSource,
  statusDotTone,
  takeLabel,
  takeLabelFromId,
  takeNumberFromId,
  validateCut,
} from "@/lib/studio-clip";

describe("studio clip helpers", () => {
  it("reads take numbers from clip ids", () => {
    expect(takeNumberFromId("c-0007")).toBe(7);
    expect(takeLabelFromId("c-0007")).toBe("Take 7");
  });

  it("labels split pieces from the original take in audio order", () => {
    const clips = [
      { id: "c-0200", parentIds: ["c-0107"], sourceStart: 4 },
      { id: "c-0201", parentIds: ["c-0107"], sourceStart: 1 },
    ];
    expect(takeLabel(clips[1], clips)).toBe("Take 107-A");
    expect(takeLabel(clips[0], clips)).toBe("Take 107-B");
    expect(takeLabel({ id: "c-0107", parentIds: [], sourceStart: 0 }, [{ id: "c-0107", parentIds: [], sourceStart: 0 }])).toBe("Take 107");
  });

  it("maps selected to accepted and everything else to not accepted", () => {
    expect(statusDotTone("selected")).toBe("accepted");
    expect(statusDotTone("rejected")).toBe("notAccepted");
    expect(statusDotTone("undecided")).toBe("notAccepted");
  });

  it("cycles the accepted / not accepted filter", () => {
    expect(cycleStatusFilter("all")).toBe("accepted");
    expect(cycleStatusFilter("accepted")).toBe("notAccepted");
    expect(cycleStatusFilter("notAccepted")).toBe("all");
    expect(clipMatchesFilter({ status: "selected" }, "accepted")).toBe(true);
    expect(clipMatchesFilter({ status: "undecided" }, "accepted")).toBe(false);
    expect(clipMatchesFilter({ status: "rejected" }, "notAccepted")).toBe(true);
  });

  it("maps padded playhead time to source time and rejects tight cuts", () => {
    expect(playheadToSource(1, 2, 0.05)).toBeCloseTo(2.95);
    expect(validateCut(0.05, 0, 4, [])).toBeTruthy();
    expect(validateCut(2, 0, 4, [2.05])).toBeTruthy();
    expect(validateCut(2, 0, 4, [])).toBeNull();
  });
});
