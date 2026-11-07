import type { DiagramSkeleton } from "../../src/diagram/skeleton.js";

export function uberSkeleton(): DiagramSkeleton {
  return {
    version: 1,
    reelId: "uber-ttl",
    title: "Uber System Design",
    cards: [
      {
        id: "redis-dynamo",
        caption: "Not a precise timer",
        direction: "down",
        nodes: [
          { id: "redis", shape: "ellipse", label: "Redis", tone: "blue", step: 1 },
          { id: "ddb", shape: "rounded", label: "DynamoDB", tone: "blue", step: 1 },
        ],
        edges: [{ id: "e1", from: "redis", to: "ddb", style: "solid", label: null, step: 2 }],
        badges: [{ id: "b1", text: "TTL - Time To Live", attachTo: "ddb", placement: "below", step: 3 }],
        annotations: [{ id: "a1", text: "10 sec", attachTo: "ddb", placement: "right", step: 4 }],
        marks: [{ id: "m1", kind: "x", attachTo: "ddb", step: 5 }],
        steps: [
          { step: 1, at: 4.2 },
          { step: 2, at: 5.0 },
          { step: 3, at: 6.1 },
          { step: 4, at: 7.0 },
          { step: 5, at: 8.4 },
        ],
      },
    ],
  };
}

export function denseSkeleton(nodeCount: number): DiagramSkeleton {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `n-${index + 1}`,
    shape: "rounded" as const,
    label: `Node ${index + 1}`,
    tone: "blue" as const,
    step: 1,
  }));
  return {
    version: 1,
    reelId: "dense-card",
    title: "Density",
    cards: [
      {
        id: "dense",
        direction: "down",
        nodes,
        edges: [],
        badges: [],
        annotations: [],
        marks: [],
        steps: [{ step: 1, at: 1 }],
      },
    ],
  };
}
