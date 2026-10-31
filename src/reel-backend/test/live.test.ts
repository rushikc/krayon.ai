import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createGeminiClient } from "../src/gemini.js";
import { silentLogger, testConfig, waitFor } from "./helpers.js";

const apiKey = process.env.KRAYON_GEMINI_API_KEY;
const describeLive = apiKey ? describe : describe.skip;

describeLive("live Gemini (opt-in)", () => {
  it(
    "generates and reviews a tiny scene",
    async () => {
      if (!apiKey) return;
      const dir = mkdtempSync(path.join(os.tmpdir(), "reel-live-"));
      const base = loadConfig();
      const config = {
        ...testConfig(dir),
        gemini: { ...base.gemini, timeoutMs: 90_000 },
        pipeline: { ...testConfig(dir).pipeline, maxRounds: 1, maxKeyframes: 3 },
      };
      const { app, store } = await buildApp({
        config,
        log: silentLogger,
        client: createGeminiClient(silentLogger),
      });
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/reel/jobs",
          headers: { "x-gemini-api-key": apiKey },
          payload: {
            script: "First a client talks to an API. Then the API talks to a database.",
            maxRounds: 1,
          },
        });
        expect(created.statusCode).toBe(202);
        const { jobId } = created.json() as { jobId: string };
        await waitFor(() => {
          const status = store.getJob(jobId)?.status;
          return status === "done" || status === "error";
        }, 180_000);
        const job = store.getJob(jobId);
        expect(job?.status).toBe("done");
        expect(job?.result?.scene.length).toBeGreaterThan(0);
      } finally {
        await app.close();
      }
    },
    200_000,
  );
});
