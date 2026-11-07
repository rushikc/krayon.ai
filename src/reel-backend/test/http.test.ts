import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { envelope, fakeGemini, MINIMAL_SCENE, silentLogger, testConfig, waitFor } from "./helpers.js";

const apps: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (apps.length) {
    const app = apps.pop();
    if (app) await app.close();
  }
});

describe("HTTP API", () => {
  it("rejects create without a Gemini key", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reel-http-"));
    const { app } = await buildApp({
      config: testConfig(dir),
      log: silentLogger,
      client: fakeGemini({ generate: () => envelope(MINIMAL_SCENE) }),
    });
    apps.push(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/reel/jobs",
      payload: { script: "hello" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHORIZED");
  });

  it("creates a job, finishes, and serves a keyframe", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reel-http2-"));
    const { app, store } = await buildApp({
      config: testConfig(dir),
      log: silentLogger,
      client: fakeGemini({
        generate: () => envelope(MINIMAL_SCENE),
        review: () => ({ clarity: 9, readability: 9, accuracy: 9, issues: [] }),
      }),
    });
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/reel/jobs",
      headers: { "x-gemini-api-key": "test-key" },
      payload: { script: "Source flows to Target." },
    });
    expect(created.statusCode).toBe(202);
    const { jobId } = created.json() as { jobId: string };
    await waitFor(() => store.getJob(jobId)?.status === "done");
    const got = await app.inject({ method: "GET", url: `/api/reel/jobs/${jobId}` });
    expect(got.statusCode).toBe(200);
    const job = got.json();
    expect(job.status).toBe("done");
    expect(job.rounds[0].keyframes.length).toBeGreaterThan(0);
    const img = await app.inject({
      method: "GET",
      url: `/api/reel/jobs/${jobId}/rounds/1/images/0`,
    });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toMatch(/png/);
  });

  it("streams a done event over SSE", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reel-sse-"));
    const { app } = await buildApp({
      config: testConfig(dir),
      log: silentLogger,
      client: fakeGemini({
        generate: () => envelope(MINIMAL_SCENE),
        review: () => ({ clarity: 9, readability: 9, accuracy: 9, issues: [] }),
      }),
    });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.addresses()[0] as { port: number };
    const created = await fetch(`http://127.0.0.1:${address.port}/api/reel/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-gemini-api-key": "test-key" },
      body: JSON.stringify({ script: "Source flows to Target." }),
    });
    const { jobId } = (await created.json()) as { jobId: string };
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${address.port}/api/reel/jobs/${jobId}/events`, {
      signal: ac.signal,
    });
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no sse body");
    const decoder = new TextDecoder();
    let buf = "";
    const start = Date.now();
    let sawDone = false;
    try {
      while (Date.now() - start < 15_000) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.includes('"type":"done"')) {
          sawDone = true;
          break;
        }
      }
    } finally {
      await reader.cancel();
      ac.abort();
    }
    expect(sawDone).toBe(true);
  });

  it("cancels a running job", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reel-cancel-"));
    const { app, store } = await buildApp({
      config: testConfig(dir),
      log: silentLogger,
      client: fakeGemini({
        generate: async () => {
          await new Promise((r) => setTimeout(r, 5_000));
          return envelope(MINIMAL_SCENE);
        },
      }),
    });
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/reel/jobs",
      headers: { "x-gemini-api-key": "test-key" },
      payload: { script: "hang" },
    });
    const { jobId } = created.json() as { jobId: string };
    const cancelled = await app.inject({ method: "POST", url: `/api/reel/jobs/${jobId}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    await waitFor(() => {
      const status = store.getJob(jobId)?.status;
      return status === "cancelled";
    });
  });

  it("lists diagram reels, serves meta, png, and rejects path escape", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reel-diagrams-"));
    const reelDir = path.join(dir, "diagrams", "_examples", "uber-ttl");
    mkdirSync(path.join(reelDir, "review", "redis-dynamo"), { recursive: true });
    writeFileSync(
      path.join(reelDir, "diagram.skeleton.json"),
      JSON.stringify({
        version: 1,
        reelId: "uber-ttl",
        title: "Uber System Design",
        cards: [{ id: "redis-dynamo", caption: "Not a precise timer", steps: [{ step: 1, at: 4.2 }] }],
      }),
    );
    writeFileSync(
      path.join(reelDir, "status.json"),
      JSON.stringify({
        reelId: "uber-ttl",
        builtAt: "2026-01-01T00:00:00Z",
        ok: true,
        round: 1,
        cards: [{ id: "redis-dynamo", steps: [{ step: 1, at: 4.2, excalidraw: "x", png: "y" }] }],
        issues: [],
      }),
    );
    writeFileSync(path.join(reelDir, "review", "redis-dynamo", "step-01.png"), Buffer.from([137, 80, 78, 71]));
    const { app } = await buildApp({
      config: testConfig(dir),
      log: silentLogger,
      client: fakeGemini({ generate: () => envelope(MINIMAL_SCENE) }),
    });
    apps.push(app);
    const listed = await app.inject({ method: "GET", url: "/api/reel/diagrams" });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().reels[0]).toMatchObject({
      reelArg: "_examples/uber-ttl",
      title: "Uber System Design",
      ok: true,
    });
    const meta = await app.inject({
      method: "GET",
      url: "/api/reel/diagrams/meta?reel=_examples/uber-ttl",
    });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().title).toBe("Uber System Design");
    const png = await app.inject({
      method: "GET",
      url: "/api/reel/diagrams/png?reel=_examples/uber-ttl&card=redis-dynamo&step=1",
    });
    expect(png.statusCode).toBe(200);
    expect(png.headers["content-type"]).toMatch(/png/);
    const escape = await app.inject({
      method: "GET",
      url: "/api/reel/diagrams/meta?reel=../secret",
    });
    expect(escape.statusCode).toBe(400);
  });
});
