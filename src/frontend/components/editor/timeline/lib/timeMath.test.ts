import { describe, expect, it } from "vitest";

import {
  canPlaceSegment,
  clampElementTime,
  computeSegmentTimingAfterDrag,
  computeSegmentTimingAfterResize,
  DEFAULT_TIMELINE_HEIGHT,
  formatRulerLabel,
  pixelToTime,
  resolveSegmentDrop,
  segmentWidthPercent,
  timeToPercent,
  TIMELINE_RULER_HEIGHT,
  TRACK_ROW_HEIGHT,
  VISIBLE_TRACK_ROWS,
  wouldRejectSegmentDrop,
} from "@/components/editor/timeline/lib/timeMath";

describe("timeline layout", () => {
  it("defaults to five visible rows", () => {
    expect(VISIBLE_TRACK_ROWS).toBe(5);
    expect(DEFAULT_TIMELINE_HEIGHT).toBe(
      TIMELINE_RULER_HEIGHT + VISIBLE_TRACK_ROWS * TRACK_ROW_HEIGHT,
    );
  });
});

describe("segment drag and collision", () => {
  it("preserves duration and clamps to the reel", () => {
    const moved = computeSegmentTimingAfterDrag(
      { start: 0, end: 10 },
      100,
      10,
      60,
    );
    expect(moved).toEqual({ start: 10, end: 20 });

    const clamped = computeSegmentTimingAfterDrag(
      { start: 0, end: 10 },
      10_000,
      10,
      60,
    );
    expect(clamped).toEqual({ start: 50, end: 60 });
  });

  it("snaps beside a blocker instead of overlapping", () => {
    const original = { start: 0, end: 10 };
    const proposed = { start: 12, end: 22 };
    const others = [{ start: 10, end: 20 }];
    expect(resolveSegmentDrop(original, proposed, others, 60)).toEqual({
      start: 20,
      end: 30,
    });
  });

  it("reverts when dropped into a gap that is too small", () => {
    const original = { start: 0, end: 10 };
    const proposed = { start: 12, end: 22 };
    const others = [
      { start: 10, end: 14 },
      { start: 16, end: 20 },
    ];
    expect(resolveSegmentDrop(original, proposed, others, 60)).toEqual(original);
    expect(wouldRejectSegmentDrop(original, proposed, others, 60)).toBe(true);
  });

  it("rejects overlapping placement on the same row", () => {
    expect(canPlaceSegment(5, 15, [{ start: 10, end: 20 }], 60)).toBe(false);
    expect(canPlaceSegment(20, 30, [{ start: 10, end: 20 }], 60)).toBe(true);
  });
});

describe("segment resize and inspector time", () => {
  it("cannot resize through a neighbor and keeps min duration", () => {
    const resized = computeSegmentTimingAfterResize(
      { start: 0, end: 10 },
      "right",
      200,
      10,
      60,
      [{ start: 12, end: 20 }],
    );
    expect(resized.end).toBe(12);
    expect(resized.start).toBe(0);
  });

  it("clamps inspector start/end to 0.5s minimum", () => {
    expect(clampElementTime(1, 1.1, 60)).toEqual({ start: 1, end: 1.5 });
    expect(clampElementTime(-2, 80, 60)).toEqual({ start: 0, end: 60 });
  });
});

describe("ruler and scrub math", () => {
  it("formats MM:SS labels", () => {
    expect(formatRulerLabel(0)).toBe("00:00");
    expect(formatRulerLabel(75)).toBe("01:15");
  });

  it("maps pointer x to time within the duration", () => {
    expect(pixelToTime(150, 0, 100, 200, 60)).toBe(15);
    expect(pixelToTime(0, 0, 100, 200, 60)).toBe(0);
  });

  it("clamps segment layout that extends past the reel", () => {
    expect(timeToPercent(125, 88)).toBe("100%");
    expect(segmentWidthPercent(0, 125, 88)).toBe("100%");
    expect(segmentWidthPercent(100, 125, 88)).toBe("0%");
  });
});
