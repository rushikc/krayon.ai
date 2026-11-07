import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reelPaths } from "../../src/diagram/paths.js";
import { writeStatus } from "../../src/diagram/report.js";

describe("status.json", () => {
  it("matches the report shape and increments round", () => {
    const dir = path.join(os.tmpdir(), `krayon-diagram-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const paths = reelPaths(dir, "demo");
    mkdirSync(paths.dir, { recursive: true });
    const first = writeStatus(paths, {
      reelId: "demo",
      cards: [
        {
          id: "card-a",
          steps: [{ step: 1, at: 1.2, excalidraw: "states/card-a/step-01.excalidraw", png: "review/card-a/step-01.png" }],
        },
      ],
      issues: [],
    });
    expect(first.ok).toBe(true);
    expect(first.round).toBe(1);
    expect(first.reelId).toBe("demo");
    expect(typeof first.builtAt).toBe("string");
    expect(first.cards[0]?.steps[0]?.excalidraw).toMatch(/step-01\.excalidraw$/);
    writeFileSync(paths.status, JSON.stringify(first));
    const second = writeStatus(paths, { reelId: "demo", cards: first.cards, issues: [] });
    expect(second.round).toBe(2);
  });
});
