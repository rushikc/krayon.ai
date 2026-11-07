import { describe, expect, it } from "vitest";

import {
  diagramReelIdFromDraft,
  diagramStepsToElements,
  visibleDiagramStep,
} from "@/lib/diagram-timeline";

const uberMeta = {
  reelArg: "_examples/uber-ttl",
  title: "Uber System Design",
  cards: [
    {
      id: "redis-dynamo",
      caption: "Not a precise timer",
      steps: [
        { step: 1, at: 4.2 },
        { step: 2, at: 5.0 },
        { step: 3, at: 6.1 },
        { step: 4, at: 7.0 },
        { step: 5, at: 8.4 },
      ],
    },
  ],
  status: { ok: true, builtAt: "2026-01-01T00:00:00Z", issues: [] },
};

describe("diagram timeline", () => {
  it("flattens one card into five blocks on one track", () => {
    const elements = diagramStepsToElements(uberMeta, 20);
    expect(elements).toHaveLength(5);
    expect(elements.every((el) => el.time.track === 0)).toBe(true);
    expect(elements[0].time.start).toBe(4.2);
    expect(elements[0].time.end).toBe(5.0);
    expect(elements[4].time.end).toBe(20);
    expect(elements[1].pngUrl).toContain("card=redis-dynamo");
    expect(elements[1].pngUrl).toContain("step=2");
  });

  it("shows the latest step whose at is at most the playhead", () => {
    const elements = diagramStepsToElements(uberMeta, 20);
    expect(visibleDiagramStep(elements, 5.5)?.step).toBe(2);
    expect(visibleDiagramStep(elements, 6.5)?.step).toBe(3);
    expect(visibleDiagramStep(elements, 0)).toBeNull();
  });

  it("treats canvasDraft v1 as no reel", () => {
    expect(diagramReelIdFromDraft({ version: 1, elements: [] })).toBeNull();
    expect(diagramReelIdFromDraft({ version: 2, reelId: "_examples/uber-ttl" })).toBe(
      "_examples/uber-ttl",
    );
    expect(diagramReelIdFromDraft({ version: 2, reelId: "" })).toBeNull();
  });
});
