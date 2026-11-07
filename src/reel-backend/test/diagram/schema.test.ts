import { describe, expect, it } from "vitest";
import { skeletonSchema } from "../../src/diagram/skeleton.js";
import { validateSkeleton } from "../../src/diagram/validate.js";
import { denseSkeleton, uberSkeleton } from "./fixtures.js";

describe("diagram skeleton schema", () => {
  it("accepts the uber example", () => {
    const parsed = skeletonSchema.safeParse(uberSkeleton());
    expect(parsed.success).toBe(true);
    const result = validateSkeleton(uberSkeleton());
    expect(result.issues.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.skeleton?.reelId).toBe("uber-ttl");
  });

  it("rejects unknown refs", () => {
    const raw = uberSkeleton();
    raw.cards[0]!.edges[0]!.to = "missing-node";
    const result = validateSkeleton(raw);
    expect(result.issues.some((item) => item.code === "UNKNOWN_REF")).toBe(true);
  });

  it("rejects long node labels", () => {
    const raw = uberSkeleton();
    raw.cards[0]!.nodes[0]!.label = "this label is way too long for the card";
    const result = validateSkeleton(raw);
    expect(result.issues.some((item) => item.code === "TEXT_TOO_LONG")).toBe(true);
  });

  it("rejects non-contiguous steps", () => {
    const raw = uberSkeleton();
    raw.cards[0]!.steps = [
      { step: 1, at: 1 },
      { step: 3, at: 2 },
    ];
    const result = validateSkeleton(raw);
    expect(result.issues.some((item) => item.code === "STEPS_NOT_CONTIGUOUS")).toBe(true);
  });

  it("rejects position keys on nodes", () => {
    const parsed = skeletonSchema.safeParse({
      ...uberSkeleton(),
      cards: [
        {
          ...uberSkeleton().cards[0],
          nodes: [{ id: "redis", shape: "ellipse", label: "Redis", tone: "blue", step: 1, x: 10 }],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("warns then errors on density", () => {
    const warn = validateSkeleton(denseSkeleton(7));
    expect(warn.issues.some((item) => item.code === "DENSITY" && item.severity === "warning")).toBe(true);
    const error = validateSkeleton(denseSkeleton(11));
    expect(error.issues.some((item) => item.code === "DENSITY" && item.severity === "error")).toBe(true);
  });

  it("warns when a step is not on a word start", () => {
    const result = validateSkeleton(uberSkeleton(), [{ word: "Redis", start: 20, end: 20.4 }]);
    expect(result.issues.some((item) => item.code === "STEP_NOT_ON_WORD")).toBe(true);
  });
});
