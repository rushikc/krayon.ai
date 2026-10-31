import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { CliExit, runCli } from "../src/cli.js";
import type { Clip, Cuts } from "../src/domain/types.js";
import { commitRevision, createProject, useProject } from "../src/store.js";

const root = await mkdtemp(path.join(tmpdir(), "krayon-studio-"));
const { app } = await buildApp({
  host: "127.0.0.1",
  port: 0,
  corsOrigins: ["http://localhost:5173"],
  pythonBase: "http://127.0.0.1:9",
  projectsDir: root,
});

let base = "";

function clip(partial: Partial<Clip> & Pick<Clip, "id" | "text">): Clip {
  const sourceStart = partial.sourceStart ?? 0;
  const sourceEnd = partial.sourceEnd ?? 1;
  return {
    id: partial.id,
    parentIds: [],
    sourceStart,
    sourceEnd,
    ranges: [{ sourceStart, sourceEnd }],
    duration: sourceEnd - sourceStart,
    text: partial.text,
    words: [
      { text: "alpha", start: sourceStart + 0.1, end: sourceStart + 0.4 },
      { text: "beta", start: sourceStart + 0.5, end: sourceEnd - 0.1 },
    ],
    groupId: partial.groupId ?? "g-0001",
    label: partial.label ?? "none",
    score: 2,
    reasons: ["reference take"],
    status: partial.status ?? "undecided",
    decidedBy: "algorithm",
    statusReason: "",
    statusAt: "",
    note: "",
    llm: {},
  };
}

beforeAll(async () => {
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  base = address;
  const meta = await createProject(root, "demo", "Demo");
  const cuts: Cuts = {
    revision: 0,
    clips: [
      clip({ id: "c-0001", text: "hello world", sourceStart: 0, sourceEnd: 2, status: "selected" }),
      clip({ id: "c-0002", text: "hello", sourceStart: 3, sourceEnd: 4, label: "cut_off" }),
    ],
    groups: [{ id: "g-0001", label: "hello world", clipIds: ["c-0001", "c-0002"], recommendedClipId: "c-0001" }],
    order: ["c-0001"],
    canvasDraft: { version: 1, elements: [] },
  };
  meta.nextClipSeq = 3;
  meta.nextGroupSeq = 2;
  await commitRevision(path.join(root, "demo"), meta, cuts, "algorithm", "analyze", "seed");
  await useProject(root, "demo");
  await writeFile(path.join(root, "demo", "source.txt"), "placeholder");
});

afterAll(async () => {
  await app.close();
});

function env() {
  return { KRAYON_STUDIO_URL: base };
}

describe("studio http and cli", () => {
  it("lists schema and project status", async () => {
    const schema = await runCli(["schema"], env());
    expect(JSON.stringify(schema)).toContain("baseRevision");
    const status = (await runCli(["status"], env())) as { meta: { slug: string }; order: string[] };
    expect(status.meta.slug).toBe("demo");
    expect(status.order).toEqual(["c-0001"]);
  });

  it("rejects a stale revision and returns the field error", async () => {
    try {
      await runCli(["op", JSON.stringify({ baseRevision: 0, ops: [{ op: "select", clipId: "c-0002" }] })], env());
      throw new Error("expected conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(CliExit);
      const exit = error as CliExit;
      expect(exit.code).toBe(2);
      expect(JSON.stringify(exit.payload)).toContain("baseRevision");
    }

    try {
      await runCli(["split", "c-0001", "--word", "9"], env());
      throw new Error("expected validation");
    } catch (error) {
      const exit = error as CliExit;
      expect(exit.code).toBe(1);
      expect(JSON.stringify(exit.payload)).toContain("wordIndex");
    }
  });

  it("selects, undoes, and reports lint through the cli", async () => {
    const selected = (await runCli(["select", "c-0002"], env())) as { revision: number; order: string[] };
    expect(selected.order).toContain("c-0002");
    const undone = (await runCli(["undo"], env())) as { revision: number };
    expect(undone.revision).toBe(selected.revision - 1);
    const redone = (await runCli(["redo"], env())) as { order: string[] };
    expect(redone.order).toContain("c-0002");
    const lint = (await runCli(["lint", "--pretty"], env())) as { warnings: { code: string }[] };
    expect(lint.warnings.some((warning) => warning.code === "duplicate_line" || warning.code === "selected_weak")).toBe(true);
    const info = (await runCli(["play-info", "c-0001"], env())) as { audioUrl: string; hint: string };
    expect(info.audioUrl).toContain("/clips/c-0001/audio.wav?pad=0.5");
    expect(info.hint).toContain("afplay");
    const history = (await runCli(["history"], env())) as { history: { actor: string }[] };
    expect(history.history.some((entry) => entry.actor === "grok" || entry.actor === "algorithm")).toBe(true);
  });

  it("treats a leading -- as pnpm's separator", async () => {
    const schema = await runCli(["--", "schema"], env());
    expect(JSON.stringify(schema)).toContain("baseRevision");
    const direct = await runCli(["schema"], env());
    expect(JSON.stringify(direct)).toContain("baseRevision");
  });

  it("posts analyze options and refuses render while analyzing", async () => {
    const calls: unknown[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/analyze") && init?.body) calls.push(JSON.parse(String(init.body)));
      return original(input, init);
    };
    try {
      await runCli(["analyze", "--silence", "0.25", "--pad", "0.08", "--similarity", "0.6", "--language", "en"], env());
      throw new Error("expected import error");
    } catch (error) {
      expect(error).toBeInstanceOf(CliExit);
      expect(JSON.stringify((error as CliExit).payload)).toContain("Import a video first");
    } finally {
      globalThis.fetch = original;
    }
    expect(calls[0]).toMatchObject({
      silenceThreshold: 0.25,
      pad: 0.08,
      similarityThreshold: 0.6,
      language: "en",
    });

    const metaPath = path.join(root, "demo", "meta.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as { status: string };
    meta.status = "analyzing";
    await writeFile(metaPath, JSON.stringify(meta));
    try {
      await runCli(["render", "--preview"], env());
      throw new Error("expected busy");
    } catch (error) {
      expect(error).toBeInstanceOf(CliExit);
      expect((error as CliExit).code).toBe(2);
      expect(JSON.stringify((error as CliExit).payload)).toContain("analyzing");
    } finally {
      meta.status = "ready";
      await writeFile(metaPath, JSON.stringify(meta));
    }
  });

  it("reports doctor checks and reset-status", async () => {
    const doctor = (await runCli(["doctor"], env())) as {
      studio: { ok: boolean };
      python: { ok: boolean; hint?: string };
    };
    expect(doctor.studio.ok).toBe(true);
    expect(typeof doctor.python.ok).toBe("boolean");
    if (!doctor.python.ok) expect(doctor.python.hint).toContain("backend");
    const reset = (await runCli(["reset-status"], env())) as { status: string };
    expect(reset.status).toMatch(/ready|error|empty/);
  });

  it("annotates a clip and updates settings", async () => {
    const annotated = (await runCli(
      ["annotate", "c-0001", "--json", JSON.stringify({ verdict: "keep", confidence: 0.8 })],
      env(),
    )) as { summary: string };
    expect(annotated.summary).toContain("annotated c-0001");
    const detail = (await runCli(["clip", "c-0001"], env())) as { clip: { llm: { verdict: string } } };
    expect(detail.clip.llm.verdict).toBe("keep");
    const listed = (await runCli(["clips"], env())) as { clips: Array<{ id: string; llm?: { verdict?: string } }> };
    expect(listed.clips.find((clip) => clip.id === "c-0001")?.llm?.verdict).toBe("keep");
    await runCli(["select", "c-0002", "--reason", "best take"], env());
    const afterSelect = (await runCli(["clip", "c-0002"], env())) as { clip: { statusReason: string } };
    expect(afterSelect.clip.statusReason).toBe("best take");
    const settings = (await runCli(["settings"], env())) as { settings: { pad: number } };
    expect(settings.settings.pad).toBe(0.05);
    const updated = (await runCli(["settings", "set", "silence", "0.3"], env())) as {
      settings: { silenceThreshold: number };
    };
    expect(updated.settings.silenceThreshold).toBe(0.3);
  });

  it("cancels a render job", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/api/audio-studio/render/async")) {
        return new Response(JSON.stringify({ jobId: "py-1" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/audio-studio/progress/py-1")) {
        return new Response("data: {\"phase\":\"rendering\",\"progress\":0.1,\"message\":\"Rendering\"}\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (url.includes("/api/audio-studio/jobs/py-1/cancel")) {
        return new Response(JSON.stringify({ status: "cancelled" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return original(input, init);
    };
    const metaPath = path.join(root, "demo", "meta.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as { status: string; sourcePath: string | null };
    meta.status = "ready";
    meta.sourcePath = path.join(root, "demo", "source.txt");
    await writeFile(metaPath, JSON.stringify(meta));
    try {
      const started = (await runCli(["render", "--preview"], env())) as { renderId: string };
      const cancelled = (await runCli(["render-cancel", started.renderId], env())) as { status: string };
      expect(cancelled.status).toBe("cancelled");
    } finally {
      globalThis.fetch = original;
      meta.status = "ready";
      await writeFile(metaPath, JSON.stringify(meta));
    }
  });

  it("splits many cuts in one revision and serves cached peaks", async () => {
    const split = (await runCli(["split", "c-0001", "--at", "0.6", "--at", "1.2"], env())) as {
      summary: string;
      revision: number;
    };
    expect(split.summary).toBe("split c-0001 into 3 clips");
    const status = (await runCli(["status"], env())) as { clips: { id: string; status: string }[]; revision: number };
    expect(status.clips).toHaveLength(4);
    expect(status.clips.filter((item) => item.status === "undecided").length).toBeGreaterThanOrEqual(3);
    const undone = (await runCli(["undo"], env())) as { revision: number };
    expect(undone.revision).toBe(split.revision - 1);
    const restored = (await runCli(["status"], env())) as { clips: { id: string }[] };
    expect(restored.clips.some((item) => item.id === "c-0001")).toBe(true);

    const after = (await runCli(["status"], env())) as { revision: number };
    const cacheDir = path.join(root, "demo", "analysis", "peaks");
    await mkdir(cacheDir, { recursive: true });
    const payload = { duration: 2, peaks: [-0.2, 0.5, -0.1, 0.4] };
    await writeFile(path.join(cacheDir, `c-0001-r${after.revision}-p0.05-b800.json`), JSON.stringify(payload));
    const peaks = await fetch(`${base}/api/studio/projects/demo/clips/c-0001/peaks`);
    expect(peaks.ok).toBe(true);
    expect(await peaks.json()).toEqual(payload);
  });
});
