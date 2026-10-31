import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    note: "",
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
});
