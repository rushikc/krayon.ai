import { describe, expect, it } from "vitest";
import { MINIMAL_SCENE, PNG_SIG, pngSize } from "./helpers.js";
import { collectKeyframeTimes } from "../src/canvas/visibility.js";
import { renderScenePng } from "../src/render/png.js";
import { sceneToSvg } from "../src/render/svgScene.js";

describe("render", () => {
  it("builds SVG containing boxes and an arrow", () => {
    const svg = sceneToSvg(MINIMAL_SCENE, 1, 1080, 1920);
    expect(svg).toContain("<svg");
    expect(svg).toContain("Source");
    expect(svg).toContain("Target");
    expect(svg).toContain("<line");
  });

  it("renders a 1080×1920 PNG", () => {
    const png = renderScenePng(MINIMAL_SCENE, 1, 1080, 1920);
    expect(png.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(pngSize(png)).toEqual({ width: 1080, height: 1920 });
  });

  it("picks a bounded set of keyframe times", () => {
    const times = collectKeyframeTimes(MINIMAL_SCENE, 8);
    expect(times.length).toBeGreaterThan(0);
    expect(times.length).toBeLessThanOrEqual(8);
    expect(times[0]).toBe(0);
  });
});
