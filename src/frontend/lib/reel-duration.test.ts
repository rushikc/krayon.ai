import { describe, expect, it } from "vitest";

import type { CanvasElement } from "@/types/canvas";

import { durationFromElements, reelDuration } from "./reel-duration";

const lateClip: CanvasElement = {
  id: "headline",
  type: "box",
  matrix: [1, 3, 16, 5],
  label: "Headline",
  colorTheme: "ink",
  time: { start: 0, end: 125, track: 2 },
};

describe("reelDuration", () => {
  it("uses the latest JSON end when there is no audio", () => {
    expect(durationFromElements([lateClip])).toBe(125);
    expect(reelDuration([lateClip])).toBe(125);
    expect(reelDuration([lateClip], null)).toBe(125);
  });

  it("uses the wav length instead of later JSON ends", () => {
    expect(reelDuration([lateClip], 88.4)).toBe(88.4);
  });
});
