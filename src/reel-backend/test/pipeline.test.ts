import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EventHub } from "../src/events.js";
import { JobRunner } from "../src/jobs.js";
import { ReelStore } from "../src/store.js";
import { envelope, fakeGemini, MINIMAL_SCENE, silentLogger, testConfig, waitFor } from "./helpers.js";

function setup(dir: string) {
  const config = testConfig(dir);
  const store = new ReelStore(config);
  const hub = new EventHub();
  return { config, store, hub };
}

describe("review/fix loop", () => {
  it("stops after one round when scores pass", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reel-pass-"));
    const { config, store, hub } = setup(dir);
    const client = fakeGemini({
      generate: () => envelope(MINIMAL_SCENE),
      review: () => ({
        clarity: 9,
        readability: 9,
        accuracy: 8,
        issues: [],
      }),
    });
    const runner = new JobRunner(store, hub, client, config, silentLogger);
    const job = store.createJob({
      id: "job-pass",
      script: "Source flows to Target.",
      models: { generate: "g", review: "r", fix: "f" },
      maxRounds: 2,
      passScore: 8,
    });
    runner.start(job.id, "test-key");
    await waitFor(() => store.getJob(job.id)?.status === "done");
    const done = store.getJob(job.id);
    expect(done?.status).toBe("done");
    expect(done?.rounds).toHaveLength(1);
    expect(done?.rounds[0]?.pass).toBe(true);
    expect(done?.rounds[0]?.keyframes.length).toBeGreaterThan(0);
    expect(done?.result?.scene).toHaveLength(3);
    store.close();
  });

  it("runs a second round when the first review is below threshold", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reel-fix-"));
    const { config, store, hub } = setup(dir);
    let reviews = 0;
    const client = fakeGemini({
      generate: () => envelope(MINIMAL_SCENE),
      review: () => {
        reviews += 1;
        if (reviews === 1) {
          return {
            clarity: 5,
            readability: 6,
            accuracy: 5,
            issues: [{ problem: "Labels collide", severity: "high", frameIndex: 0 }],
          };
        }
        return { clarity: 9, readability: 9, accuracy: 9, issues: [] };
      },
      fix: () => envelope(MINIMAL_SCENE),
    });
    const runner = new JobRunner(store, hub, client, config, silentLogger);
    store.createJob({
      id: "job-fix",
      script: "Source flows to Target.",
      models: { generate: "g", review: "r", fix: "f" },
      maxRounds: 2,
      passScore: 8,
    });
    runner.start("job-fix", "test-key");
    await waitFor(() => store.getJob("job-fix")?.status === "done");
    const done = store.getJob("job-fix");
    expect(done?.rounds).toHaveLength(2);
    expect(done?.rounds[0]?.pass).toBe(false);
    expect(done?.rounds[1]?.pass).toBe(true);
    expect(done?.rounds[0]?.issues[0]?.problem).toMatch(/collide/);
    expect(reviews).toBe(2);
    store.close();
  });

  it("keeps the first round when a fix is invalid", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reel-badfix-"));
    const { config, store, hub } = setup(dir);
    const client = fakeGemini({
      generate: () => envelope(MINIMAL_SCENE),
      review: () => ({
        clarity: 4,
        readability: 4,
        accuracy: 4,
        issues: [{ problem: "Wrong", severity: "high" }],
      }),
      fix: () => ({ elements: [{ id: "nope" }] }),
      repair: () => ({ elements: [{ id: "nope" }] }),
    });
    const runner = new JobRunner(store, hub, client, config, silentLogger);
    store.createJob({
      id: "job-badfix",
      script: "Source flows to Target.",
      models: { generate: "g", review: "r", fix: "f" },
      maxRounds: 2,
      passScore: 8,
    });
    runner.start("job-badfix", "test-key");
    await waitFor(() => store.getJob("job-badfix")?.status === "done");
    const done = store.getJob("job-badfix");
    expect(done?.rounds).toHaveLength(1);
    expect(done?.result?.round).toBe(1);
    store.close();
  });
});
