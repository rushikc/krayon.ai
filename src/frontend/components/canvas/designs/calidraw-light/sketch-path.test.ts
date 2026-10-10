import { describe, expect, it } from "vitest";

import {
  sketchArrowCurve,
  sketchCirclePath,
  sketchRoundedRectPath,
} from "./sketch-path";

describe("calidraw-light sketch paths", () => {
  it("is stable for the same id", () => {
    expect(sketchRoundedRectPath("box-a")).toBe(sketchRoundedRectPath("box-a"));
    expect(sketchCirclePath("n-1")).toBe(sketchCirclePath("n-1"));
    expect(sketchArrowCurve("arr", 10, 10, 40, 80)).toBe(
      sketchArrowCurve("arr", 10, 10, 40, 80),
    );
  });

  it("varies by id", () => {
    expect(sketchRoundedRectPath("a")).not.toBe(sketchRoundedRectPath("b"));
  });

  it("uses cubic segments instead of a dense polyline", () => {
    const rect = sketchRoundedRectPath("box-a", { aspect: 4 });
    const circle = sketchCirclePath("n-1");
    expect(rect).toMatch(/C /);
    expect(circle).toMatch(/C /);
    expect(rect.split(" L ").length).toBe(1);
  });
});
