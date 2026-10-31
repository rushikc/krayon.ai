import { describe, expect, it } from "vitest";
import { MINIMAL_SCENE } from "./helpers.js";
import { safeParseScene } from "../src/schema/scene.js";

describe("scene schema", () => {
  it("accepts the minimal valid scene", () => {
    const parsed = safeParseScene(MINIMAL_SCENE);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.elements).toHaveLength(3);
  });

  it("accepts an envelope and unwraps it", () => {
    const parsed = safeParseScene({ elements: MINIMAL_SCENE });
    expect(parsed.ok).toBe(true);
  });

  it("rejects out-of-bounds matrix", () => {
    const parsed = safeParseScene([
      {
        ...MINIMAL_SCENE[0],
        matrix: [0, 0, 18, 7],
      },
    ]);
    expect(parsed.ok).toBe(false);
  });

  it("rejects an unknown colorTheme", () => {
    const parsed = safeParseScene([
      {
        ...MINIMAL_SCENE[0],
        colorTheme: "neon",
      },
    ]);
    expect(parsed.ok).toBe(false);
  });

  it("rejects an arrow pointing at a number", () => {
    const parsed = safeParseScene([
      {
        id: "n1",
        type: "number",
        matrix: [0, 4],
        value: 1,
        colorTheme: "ink",
        time: { start: 0, end: 4, track: 1 },
      },
      {
        id: "box",
        type: "box",
        matrix: [2, 4, 15, 7],
        label: "Only",
        colorTheme: "sky",
        time: { start: 0, end: 4, track: 2 },
      },
      {
        id: "bad",
        type: "arrow",
        sourceId: "box",
        targetId: "n1",
        time: { start: 0.5, end: 4, track: 7 },
      },
    ]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/targetId/);
  });

  it("rejects duplicate ids", () => {
    const parsed = safeParseScene([
      MINIMAL_SCENE[0],
      { ...MINIMAL_SCENE[0], matrix: [2, 10, 15, 12] },
    ]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/duplicate id/);
  });

  it("rejects missing time", () => {
    const parsed = safeParseScene([
      {
        id: "a",
        type: "box",
        matrix: [2, 4, 15, 7],
        label: "Source",
        colorTheme: "sky",
      },
    ]);
    expect(parsed.ok).toBe(false);
  });

  it("rejects x/y/width/height keys", () => {
    const parsed = safeParseScene([
      {
        ...MINIMAL_SCENE[0],
        x: 10,
      },
    ]);
    expect(parsed.ok).toBe(false);
  });
});
