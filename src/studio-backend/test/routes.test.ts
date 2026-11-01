import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analysisOf, clip, http, listenStudio, seedProject, type PythonState } from "./helpers.js";

let base = "";
let root = "";
let state: PythonState;
let close: () => Promise<void>;

beforeAll(async () => {
  const studio = await listenStudio();
  base = studio.base;
  root = studio.root;
  state = studio.state;
  close = studio.close;
});

afterAll(async () => {
  await close();
});

async function project(slug: string) {
  return http(base, "GET", `/api/studio/projects/${slug}`);
}

describe("projects", () => {
  it("creates, lists, switches, and suffixes a slug collision", async () => {
    const created = await http(base, "POST", "/api/studio/projects", { title: "Routes Demo", slug: "routes-demo" });
    expect(created.status).toBe(201);
    expect(created.payload.slug).toBe("routes-demo");
    const again = await http(base, "POST", "/api/studio/projects", { title: "Routes Demo", slug: "routes-demo" });
    expect(again.status).toBe(201);
    expect(again.payload.slug).toBe("routes-demo-2");
    const listed = await http(base, "GET", "/api/studio/projects");
    const slugs = (listed.payload.projects as { slug: string }[]).map((item) => item.slug);
    expect(slugs).toEqual(expect.arrayContaining(["routes-demo", "routes-demo-2"]));
    const used = await http(base, "POST", "/api/studio/projects/use", { slug: "routes-demo" });
    expect(used.payload.current).toBe("routes-demo");
    const current = await readFile(path.join(root, ".current"), "utf8");
    expect(current.trim()).toBe("routes-demo");
  });

  it.fails("BUG: invalid project slug returns 500 instead of a validation error", async () => {
    const response = await fetch(`${base}/api/studio/projects/NOPE`);
    expect(response.status).toBe(400);
  });
});

describe("settings", () => {
  it("returns defaults, patches a subset, and keeps finite out-of-range numbers", async () => {
    await http(base, "POST", "/api/studio/projects", { title: "Settings", slug: "settings-demo" });
    const defaults = await http(base, "GET", "/api/studio/projects/settings-demo/settings");
    expect(defaults.payload.settings).toMatchObject({
      silenceThreshold: 0.4,
      pad: 0.05,
      similarityThreshold: 0.7,
      snapToAudio: true,
      snapSearchSeconds: 0.3,
    });
    const patched = await http(base, "PATCH", "/api/studio/projects/settings-demo/settings", { pad: 0.08 });
    expect(patched.payload.settings).toMatchObject({ pad: 0.08, silenceThreshold: 0.4, snapToAudio: true });
    const extreme = await http(base, "PATCH", "/api/studio/projects/settings-demo/settings", {
      silenceThreshold: -5,
      snapSearchSeconds: 99,
      snapToAudio: false,
    });
    expect(extreme.payload.settings).toMatchObject({ silenceThreshold: -5, snapSearchSeconds: 99, snapToAudio: false, pad: 0.08 });
    const disk = JSON.parse(await readFile(path.join(root, "settings-demo", "meta.json"), "utf8")) as {
      settings: { silenceThreshold: number };
    };
    expect(disk.settings.silenceThreshold).toBe(-5);
    const again = await http(base, "GET", "/api/studio/projects/settings-demo/settings");
    expect(again.payload.settings).toMatchObject({ silenceThreshold: -5, pad: 0.08 });
    const wrong = await http(base, "PATCH", "/api/studio/projects/settings-demo/settings", { pad: "wide" });
    expect(wrong.status).toBe(400);
  });
});

describe("script", () => {
  it("sets and clears script text, counts lines, and rejects a stale revision", async () => {
    await http(base, "POST", "/api/studio/projects", { title: "Script", slug: "script-demo" });
    const longLine = `こんにちは ${"word ".repeat(4000)}`;
    const body = `alpha\r\n\r\nbeta  \r\n${longLine}\n`;
    const put = await http(base, "PUT", "/api/studio/projects/script-demo/script", { baseRevision: 0, script: body });
    expect(put.status).toBe(200);
    expect(put.payload.scriptLineCount).toBe(3);
    expect(put.payload.needsRebuild).toBe(true);
    const raw = await readFile(path.join(root, "script-demo", "script.txt"), "utf8");
    expect(raw).toContain("こんにちは");
    expect(raw).not.toContain("\r");
    const history = await http(base, "GET", "/api/studio/projects/script-demo/history");
    expect((history.payload.history as { label: string }[]).some((entry) => entry.label === "script")).toBe(true);
    const stale = await http(base, "PUT", "/api/studio/projects/script-demo/script", { baseRevision: 0, script: "nope" });
    expect(stale.status).toBe(409);
    expect(stale.payload.error).toBe("conflict");
    expect(typeof stale.payload.currentRevision).toBe("number");
    const cleared = await http(base, "PUT", "/api/studio/projects/script-demo/script", {
      baseRevision: put.payload.revision,
      script: "",
    });
    expect(cleared.payload.scriptLineCount).toBe(0);
    const clearedProject = await project("script-demo");
    expect(String(clearedProject.payload.script).trim()).toBe("");
  });
});

describe("ops", () => {
  async function ready(slug: string) {
    const revision = await seedProject(root, slug, [
      clip({ id: "c-0001", text: "alpha beta", sourceStart: 0, sourceEnd: 2, status: "selected" }),
      clip({ id: "c-0002", text: "gamma delta", sourceStart: 2.2, sourceEnd: 4, status: "undecided", groupId: "g-0002" }),
    ]);
    return revision;
  }

  it("runs every op and reports field errors", async () => {
    const revision = await ready("ops-demo");
    const cases: Array<{ op: Record<string, unknown>; field?: string }> = [
      { op: { op: "reject", clipId: "c-0002" } },
      { op: { op: "undecided", clipId: "c-0001" } },
      { op: { op: "select", clipId: "c-0001" } },
      { op: { op: "select", clipId: "c-0002" } },
      { op: { op: "reorder", order: ["c-0002", "c-0001"] } },
      { op: { op: "note", clipId: "c-0002", note: "keep" } },
      { op: { op: "annotate", clipId: "c-0002", llm: { verdict: "keep" } } },
      { op: { op: "moveToGroup", clipId: "c-0002", groupId: "g-0001" } },
      { op: { op: "ungroup", clipId: "c-0002" } },
      { op: { op: "trim", clipId: "c-0001", start: 0.2, end: 1.8, sampleAccurate: true } },
      { op: { op: "split", clipId: "c-0001", at: 1, sampleAccurate: true } },
    ];
    let current = revision;
    for (const item of cases) {
      const response = await http(base, "POST", "/api/studio/projects/ops-demo/ops", { baseRevision: current, ops: [item.op] });
      expect(response.status, JSON.stringify(item.op)).toBe(200);
      current = response.payload.revision as number;
    }
    const after = await project("ops-demo");
    const clips = after.payload.clips as { id: string; parentIds: string[]; note: string; llm: { verdict?: string } }[];
    expect(clips.find((item) => item.id === "c-0001")).toBeUndefined();
    expect(clips.some((item) => item.parentIds.includes("c-0001"))).toBe(true);
    const noted = clips.find((item) => item.note === "keep");
    expect(noted?.llm.verdict).toBe("keep");

    const badReorder = await http(base, "POST", "/api/studio/projects/ops-demo/ops", {
      baseRevision: current,
      ops: [{ op: "reorder", order: ["c-0001"] }],
    });
    expect(badReorder.status).toBe(400);
    expect(badReorder.payload.errors).toEqual([
      expect.objectContaining({ field: "order", allowed: expect.any(Array) }),
    ]);
    const outside = await http(base, "POST", "/api/studio/projects/ops-demo/ops", {
      baseRevision: current,
      ops: [{ op: "split", clipId: clips[0]!.id, at: 99, sampleAccurate: true }],
    });
    expect(outside.status).toBe(400);
    expect((outside.payload.errors as { field: string; clipId: string }[])[0]).toMatchObject({
      field: "at",
      clipId: clips[0]!.id,
    });
    const stale = await http(base, "POST", "/api/studio/projects/ops-demo/ops", {
      baseRevision: 0,
      ops: [{ op: "select", clipId: clips[0]!.id }],
    });
    expect(stale.status).toBe(409);
  });

  it("rejects a merge across a gap over 1s and a trim without words unless sampleAccurate", async () => {
    const revision = await seedProject(root, "merge-demo", [
      clip({ id: "c-0001", text: "alpha beta", sourceStart: 0, sourceEnd: 1, status: "selected", words: [] }),
      clip({ id: "c-0002", text: "gamma delta", sourceStart: 3, sourceEnd: 4, status: "selected", groupId: "g-0002" }),
    ]);
    const gap = await http(base, "POST", "/api/studio/projects/merge-demo/ops", {
      baseRevision: revision,
      ops: [{ op: "merge", clipIds: ["c-0001", "c-0002"] }],
    });
    expect(gap.status).toBe(400);
    expect(JSON.stringify(gap.payload)).toContain("not adjacent");
    const trim = await http(base, "POST", "/api/studio/projects/merge-demo/ops", {
      baseRevision: revision,
      ops: [{ op: "trim", clipId: "c-0001", start: 0.1, end: 0.8 }],
    });
    expect(trim.status).toBe(400);
    expect(JSON.stringify(trim.payload)).toContain("sampleAccurate");
    const exact = await http(base, "POST", "/api/studio/projects/merge-demo/ops", {
      baseRevision: revision,
      ops: [{ op: "trim", clipId: "c-0001", start: 0.1, end: 0.8, sampleAccurate: true }],
    });
    expect(exact.status).toBe(200);
  });

  it("rolls back a batch when a later op fails", async () => {
    const revision = await seedProject(root, "batch-demo", [
      clip({ id: "c-0001", text: "alpha beta", sourceStart: 0, sourceEnd: 2, status: "undecided" }),
    ]);
    const response = await http(base, "POST", "/api/studio/projects/batch-demo/ops", {
      baseRevision: revision,
      ops: [
        { op: "select", clipId: "c-0001" },
        { op: "split", clipId: "c-0001", at: 50, sampleAccurate: true },
      ],
    });
    expect(response.status).toBe(400);
    const after = await project("batch-demo");
    expect(after.payload.revision).toBe(revision);
    const clips = after.payload.clips as { id: string; status: string }[];
    expect(clips).toEqual([expect.objectContaining({ id: "c-0001", status: "undecided" })]);
  });

  it("splits many cuts and merges adjacent clips with parent ids", async () => {
    const revision = await seedProject(root, "split-demo", [
      clip({ id: "c-0001", text: "alpha beta", sourceStart: 0, sourceEnd: 3, status: "selected" }),
      clip({ id: "c-0002", text: "gamma delta", sourceStart: 3.1, sourceEnd: 4.5, status: "undecided", groupId: "g-0001" }),
    ]);
    const many = await http(base, "POST", "/api/studio/projects/split-demo/ops", {
      baseRevision: revision,
      ops: [{ op: "splitMany", clipId: "c-0001", at: [1, 2] }],
    });
    expect(many.status).toBe(200);
    expect(many.payload.summary).toContain("3 clips");
    const merged = await http(base, "POST", "/api/studio/projects/split-demo/ops", {
      baseRevision: many.payload.revision,
      ops: [{ op: "merge", clipIds: ["c-0002", "c-0002"] }],
    });
    expect(merged.status).toBe(400);
    const body = await project("split-demo");
    const kids = (body.payload.clips as { id: string; parentIds: string[]; sourceEnd: number }[])
      .filter((item) => item.parentIds.includes("c-0001"))
      .sort((a, b) => a.sourceEnd - b.sourceEnd);
    const right = kids[kids.length - 1]!;
    const join = await http(base, "POST", "/api/studio/projects/split-demo/ops", {
      baseRevision: body.payload.revision,
      ops: [{ op: "merge", clipIds: [right.id, "c-0002"] }],
    });
    expect(join.status).toBe(200);
    const final = await project("split-demo");
    const created = (final.payload.clips as { parentIds: string[] }[]).find((item) => item.parentIds.includes(right.id));
    expect(created?.parentIds).toEqual(expect.arrayContaining([right.id, "c-0002"]));
  });

  it.fails("BUG: reanalyze snaps every clip and does not lock manual splits", async () => {
    const revision = await seedProject(root, "manual-demo", [
      clip({ id: "c-0001", text: "alpha beta", sourceStart: 0, sourceEnd: 2, status: "selected" }),
    ]);
    const split = await http(base, "POST", "/api/studio/projects/manual-demo/ops", {
      baseRevision: revision,
      ops: [{ op: "split", clipId: "c-0001", at: 1, sampleAccurate: true }],
    });
    expect(split.status).toBe(200);
    const before = await project("manual-demo");
    const right = (before.payload.clips as { id: string; sourceStart: number; sourceEnd: number; text: string; groupId: string }[]).find(
      (item) => item.sourceStart === 1,
    )!;
    state.payload = analysisOf([
      { id: "py-right", text: right.text, sourceStart: 0.85, sourceEnd: right.sourceEnd, groupId: right.groupId },
    ]);
    state.payload.scope = "range";
    state.payload.rangeStart = 0.5;
    state.payload.rangeEnd = 2;
    const again = await http(base, "POST", "/api/studio/projects/manual-demo/reanalyze", {
      baseRevision: before.payload.revision,
      mode: "resegment",
      clipIds: [right.id],
    });
    expect(again.status).toBe(200);
    const after = await project("manual-demo");
    const moved = (after.payload.clips as { id: string; sourceStart: number }[]).find((item) => item.id === right.id);
    expect(moved?.sourceStart).toBe(1);
  });
});

describe("history", () => {
  it("undo, redo, restore, drops the redo branch, and never reuses ids", async () => {
    const revision = await seedProject(root, "history-demo", [
      clip({ id: "c-0001", text: "alpha beta", sourceStart: 0, sourceEnd: 2, status: "selected" }),
    ], { nextClipSeq: 2 });
    const split = await http(base, "POST", "/api/studio/projects/history-demo/ops", {
      baseRevision: revision,
      ops: [{ op: "split", clipId: "c-0001", at: 1, sampleAccurate: true }],
    });
    const undone = await http(base, "POST", "/api/studio/projects/history-demo/undo");
    expect(undone.payload.revision).toBe((split.payload.revision as number) - 1);
    const redone = await http(base, "POST", "/api/studio/projects/history-demo/redo");
    expect(redone.payload.revision).toBe(split.payload.revision);
    await http(base, "POST", "/api/studio/projects/history-demo/undo");
    const fresh = await project("history-demo");
    const edited = await http(base, "POST", "/api/studio/projects/history-demo/ops", {
      baseRevision: fresh.payload.revision,
      ops: [{ op: "note", clipId: "c-0001", note: "branch" }],
    });
    expect(edited.status).toBe(200);
    const blocked = await http(base, "POST", "/api/studio/projects/history-demo/redo");
    expect(blocked.status).toBe(400);
    expect(blocked.payload.message).toBe("Nothing to redo");
    const restored = await http(base, "POST", "/api/studio/projects/history-demo/restore", { revision: split.payload.revision });
    expect(restored.status).toBe(200);
    expect(restored.payload.revision).toBe((edited.payload.revision as number) + 1);
    const again = await project("history-demo");
    const another = await http(base, "POST", "/api/studio/projects/history-demo/ops", {
      baseRevision: again.payload.revision,
      ops: [{ op: "split", clipId: (again.payload.clips as { id: string; sourceEnd: number }[]).find((item) => item.sourceEnd > 1)!.id, at: 1.4, sampleAccurate: true }],
    });
    expect(another.status).toBe(200);
    const ids = (await project("history-demo")).payload.clips as { id: string }[];
    const numbers = ids.map((item) => Number(item.id.slice(2)));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(Math.max(...numbers)).toBeGreaterThan(4);
  });
});

describe("analyze and reanalyze", () => {
  it("moves analyzing to ready, recovers a stuck status, and rejects a second analyze", async () => {
    await http(base, "POST", "/api/studio/projects", { title: "Analyze", slug: "analyze-demo" });
    const source = path.join(root, "analyze-demo", "source.txt");
    await writeFile(source, "video");
    const imported = await http(base, "POST", "/api/studio/projects/analyze-demo/import", { path: source });
    expect(imported.status).toBe(200);
    state.mode = "ok";
    state.payload = analysisOf([{ id: "py-1", text: "alpha beta", sourceStart: 0.2, sourceEnd: 1.8, groupId: "py" }]);
    const done = await http(base, "POST", "/api/studio/projects/analyze-demo/analyze", { baseRevision: 0 });
    expect(done.status).toBe(200);
    const ready = await project("analyze-demo");
    expect((ready.payload.meta as { status: string }).status).toBe("ready");
    expect((ready.payload.clips as unknown[]).length).toBe(1);

    state.mode = "error";
    const failed = await http(base, "POST", "/api/studio/projects/analyze-demo/analyze", {});
    expect(failed.status).toBeGreaterThanOrEqual(400);
    const errored = await project("analyze-demo");
    expect((errored.payload.meta as { status: string }).status).toBe("error");
    const metaPath = path.join(root, "analyze-demo", "meta.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as { status: string };
    meta.status = "analyzing";
    await writeFile(metaPath, JSON.stringify(meta));
    const reset = await http(base, "POST", "/api/studio/projects/analyze-demo/reset-status");
    expect(reset.payload.status).not.toBe("analyzing");

    state.mode = "hang";
    const pending = http(base, "POST", "/api/studio/projects/analyze-demo/analyze", {});
    try {
      await expect.poll(async () => ((await project("analyze-demo")).payload.meta as { status: string }).status).toBe("analyzing");
      const second = await http(base, "POST", "/api/studio/projects/analyze-demo/analyze", {});
      expect(second.status).toBe(409);
    } finally {
      state.release?.();
      await pending.catch(() => undefined);
      state.mode = "ok";
    }
  });

  it("keeps ids at a high overlap, mints ids on reset, and preserves a human decision", async () => {
    const revision = await seedProject(root, "adopt-demo", [
      clip({ id: "c-0001", text: "alpha beta", sourceStart: 0, sourceEnd: 2, status: "selected", decidedBy: "human" }),
    ]);
    state.mode = "ok";
    state.payload = analysisOf([{ id: "py-1", text: "alpha beta", sourceStart: 0.1, sourceEnd: 1.9, groupId: "py" }]);
    const kept = await http(base, "POST", "/api/studio/projects/adopt-demo/reanalyze", {
      baseRevision: revision,
      mode: "regroup",
    });
    expect(kept.status).toBe(200);
    const after = await project("adopt-demo");
    const matched = (after.payload.clips as { id: string; status: string; decidedBy: string }[]).find((item) => item.id === "c-0001");
    expect(matched?.status).toBe("selected");
    expect(matched?.decidedBy).toBe("human");

    state.payload = analysisOf([{ id: "py-new", text: "other line", sourceStart: 5, sourceEnd: 7, groupId: "py2" }]);
    const reset = await http(base, "POST", "/api/studio/projects/adopt-demo/reanalyze", {
      baseRevision: after.payload.revision,
      mode: "resegment",
      reset: true,
    });
    expect(reset.status).toBe(200);
    const minted = await project("adopt-demo");
    const ids = (minted.payload.clips as { id: string }[]).map((item) => item.id);
    expect(ids).not.toContain("c-0001");

    state.mode = "error";
    const missing = await http(base, "POST", "/api/studio/projects/adopt-demo/reanalyze", {
      baseRevision: minted.payload.revision,
      mode: "retranscribe",
    });
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(((await project("adopt-demo")).payload.meta as { statusMessage: string }).statusMessage).toContain("no transcript");
    state.mode = "ok";
  });

  it("honors a scripted pipeline override", async () => {
    const revision = await seedProject(root, "pipe-demo", [
      clip({ id: "c-0001", text: "alpha beta", sourceStart: 0, sourceEnd: 2, status: "undecided" }),
    ], { script: "alpha beta\n" });
    state.payload = {
      ...analysisOf([{ id: "py-1", text: "alpha beta", sourceStart: 0.1, sourceEnd: 1.9, groupId: "py" }]),
      pipeline: "scripted",
      groups: [{ id: "py", label: "alpha beta", clipIds: ["py-1"], referenceClipId: "py-1", scriptLine: 1 }],
      clips: [
        {
          id: "py-1",
          text: "alpha beta",
          sourceStart: 0.1,
          sourceEnd: 1.9,
          groupId: "py",
          status: "selected",
          script: { line: 1, text: "alpha beta", score: 0.99 },
        },
      ],
    };
    const response = await http(base, "POST", "/api/studio/projects/pipe-demo/reanalyze", {
      baseRevision: revision,
      mode: "resegment",
      pipeline: "scripted",
    });
    expect(response.status).toBe(200);
    const meta = ((await project("pipe-demo")).payload.meta as { lastPipeline: string });
    expect(meta.lastPipeline).toBe("scripted");
  });
});

describe("events and render", () => {
  it("emits snapshot, revision, progress, render, and confirmation events, then reconnects", async () => {
    const revision = await seedProject(root, "events-demo", [
      clip({ id: "c-0001", text: "alpha beta", sourceStart: 0, sourceEnd: 2, status: "selected" }),
    ]);
    const seen: string[] = [];
    const controller = new AbortController();
    const reconnect = new AbortController();
    const response = await fetch(`${base}/api/studio/projects/events-demo/events`, { signal: controller.signal });
    const reader = response.body!.getReader();
    try {
    const decoder = new TextDecoder();
    let buffer = "";
    const next = async () => {
      while (!buffer.includes("\n\n")) {
        const chunk = await reader.read();
        if (chunk.done) return null;
        buffer += decoder.decode(chunk.value);
      }
      const block = buffer.slice(0, buffer.indexOf("\n\n"));
      buffer = buffer.slice(buffer.indexOf("\n\n") + 2);
      const line = block.split("\n").find((item) => item.startsWith("data:"));
      if (!line) return next();
      return JSON.parse(line.slice(5).trim()) as { type: string };
    };
    expect((await next())?.type).toBe("snapshot");
    await http(base, "POST", "/api/studio/projects/events-demo/ops", {
      baseRevision: revision,
      ops: [{ op: "note", clipId: "c-0001", note: "live" }],
    });
    expect((await next())?.type).toBe("revision");
    state.mode = "ok";
    const current = await project("events-demo");
    const analyzed = http(base, "POST", "/api/studio/projects/events-demo/analyze", { baseRevision: current.payload.revision });
    const kinds = new Set<string>();
    for (let i = 0; i < 6; i += 1) {
      const event = await next();
      if (!event) break;
      kinds.add(event.type);
      if (kinds.has("progress") && kinds.has("revision")) break;
    }
    await analyzed;
    expect(kinds.has("progress") || kinds.has("revision")).toBe(true);
    const ask = await http(base, "POST", "/api/studio/projects/events-demo/confirmations", {
      kind: "confirm",
      title: "Keep?",
      options: [{ id: "accept", label: "Accept" }, { id: "decline", label: "Decline" }],
    });
    expect(ask.status).toBe(200);
    let confirmation: { type: string } | null = null;
    for (let i = 0; i < 8 && confirmation?.type !== "confirmation_created"; i += 1) {
      confirmation = await next();
    }
    expect(confirmation?.type).toBe("confirmation_created");
    seen.push(confirmation?.type ?? "");
    const again = await fetch(`${base}/api/studio/projects/events-demo/events`, { signal: reconnect.signal });
    const reconnectReader = again.body!.getReader();
    const text = new TextDecoder().decode((await reconnectReader.read()).value);
    expect(text).toContain("\"type\":\"snapshot\"");
    await reconnectReader.cancel().catch(() => undefined);
    } finally {
      controller.abort();
      reconnect.abort();
      await reader.cancel().catch(() => undefined);
    }
  });

  it("renders, cancels, lists the manifest, and rejects an empty selection", async () => {
    await seedProject(root, "render-demo", [
      clip({ id: "c-0001", text: "alpha beta", sourceStart: 0, sourceEnd: 2, status: "undecided" }),
    ]);
    const empty = await http(base, "POST", "/api/studio/projects/render-demo/render", { quality: "preview" });
    expect(empty.status).toBe(400);
    expect(JSON.stringify(empty.payload)).toContain("Select at least one clip");
    const revision = (await project("render-demo")).payload.revision as number;
    await http(base, "POST", "/api/studio/projects/render-demo/ops", {
      baseRevision: revision,
      ops: [{ op: "select", clipId: "c-0001" }],
    });
    state.mode = "ok";
    const started = await http(base, "POST", "/api/studio/projects/render-demo/render", { quality: "final" });
    expect(started.status).toBe(200);
    const renderId = started.payload.renderId as string;
    await expect.poll(async () => (await http(base, "GET", `/api/studio/projects/render-demo/render/${renderId}`)).payload.status).toBe("done");
    const output = await http(base, "GET", "/api/studio/projects/render-demo/output");
    expect(JSON.stringify(output.payload.manifests)).toContain("final");
    state.mode = "hang";
    const preview = await http(base, "POST", "/api/studio/projects/render-demo/render", { quality: "preview" });
    const pendingId = preview.payload.renderId as string;
    const cancelled = await http(base, "POST", `/api/studio/projects/render-demo/render/${pendingId}/cancel`);
    expect(cancelled.payload.status).toBe("cancelled");
    state.release?.();
    state.mode = "ok";
  });

  it("lints a project that has no wav", async () => {
    await seedProject(root, "lint-demo", [
      clip({ id: "c-0001", text: "alpha", sourceStart: 0, sourceEnd: 0.2, duration: 0.2, status: "selected" }),
    ]);
    const response = await http(base, "GET", "/api/studio/projects/lint-demo/lint");
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.payload)).toContain("short_clip");
  });
});
