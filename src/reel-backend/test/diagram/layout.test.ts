import { describe, expect, it } from "vitest";
import { toExcalidrawElements } from "../../src/diagram/excalidraw.js";
import { elementsVisibleAt, layoutSkeleton } from "../../src/diagram/layout.js";
import { uberSkeleton } from "./fixtures.js";

describe("diagram layout", () => {
  it("is deterministic", async () => {
    const cards = uberSkeleton().cards;
    const a = await layoutSkeleton(cards);
    const b = await layoutSkeleton(cards);
    expect(a.layouts).toEqual(b.layouts);
  });

  it("keeps earlier elements on later cumulative steps", async () => {
    const card = uberSkeleton().cards[0]!;
    const { layouts } = await layoutSkeleton([card]);
    const layout = layouts[0]!;
    const step1 = elementsVisibleAt(layout, 1);
    const step5 = elementsVisibleAt(layout, 5);
    expect(step1.nodes.map((n) => n.id).sort()).toEqual(["ddb", "redis"]);
    expect(step1.edges).toHaveLength(0);
    expect(step5.nodes.map((n) => n.id).sort()).toEqual(["ddb", "redis"]);
    expect(step5.edges.map((e) => e.id)).toEqual(["e1"]);
    expect(step5.badges.map((b) => b.id)).toEqual(["b1"]);
    expect(step5.annotations.map((a) => a.id)).toEqual(["a1"]);
    expect(step5.marks.map((m) => m.id)).toEqual(["m1"]);
  });

  it("stamps customData.rushk.step on every element", async () => {
    const card = uberSkeleton().cards[0]!;
    const { layouts } = await layoutSkeleton([card]);
    const { elements } = await toExcalidrawElements(layouts[0]!, card);
    expect(elements.length).toBeGreaterThan(0);
    for (const el of elements) {
      expect(el.customData?.rushk.cardId).toBe("redis-dynamo");
      expect(el.customData?.rushk.step).toBeGreaterThanOrEqual(1);
    }
  });
});
