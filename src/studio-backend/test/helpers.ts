import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import type { AnalysisPayload } from "../src/domain/adopt.js";
import type { Clip, Cuts } from "../src/domain/types.js";
import { commitRevision, createProject } from "../src/store.js";

export type PythonState = {
  mode: "ok" | "error" | "hang";
  payload: AnalysisPayload;
  release: (() => void) | null;
  calls: string[];
};

export function clip(partial: Partial<Clip> & Pick<Clip, "id" | "text">): Clip {
  const sourceStart = partial.sourceStart ?? 0;
  const sourceEnd = partial.sourceEnd ?? 2;
  return {
    id: partial.id,
    parentIds: partial.parentIds ?? [],
    sourceStart,
    sourceEnd,
    ranges: partial.ranges ?? [{ sourceStart, sourceEnd }],
    duration: partial.duration ?? sourceEnd - sourceStart,
    text: partial.text,
    words: partial.words ?? [
      { text: "alpha", start: sourceStart + 0.2, end: sourceStart + 0.6 },
      { text: "beta", start: sourceStart + 0.8, end: sourceEnd - 0.2 },
    ],
    groupId: partial.groupId ?? "g-0001",
    label: partial.label ?? "none",
    score: partial.score ?? 2,
    reasons: partial.reasons ?? ["reference take"],
    status: partial.status ?? "undecided",
    decidedBy: partial.decidedBy ?? "algorithm",
    statusReason: partial.statusReason ?? "",
    statusAt: partial.statusAt ?? "",
    note: partial.note ?? "",
    llm: partial.llm ?? {},
    script: partial.script,
  };
}

export function analysisOf(clips: Array<Pick<Clip, "id" | "text" | "sourceStart" | "sourceEnd" | "groupId">>): AnalysisPayload {
  return {
    pipeline: "transcript",
    scope: "full",
    clips: clips.map((item) => ({
      id: item.id,
      text: item.text,
      sourceStart: item.sourceStart,
      sourceEnd: item.sourceEnd,
      groupId: item.groupId,
      words: [
        { text: "alpha", start: item.sourceStart + 0.1, end: item.sourceStart + 0.4 },
        { text: "beta", start: item.sourceEnd - 0.4, end: item.sourceEnd - 0.1 },
      ],
    })),
    groups: [
      {
        id: "py-g",
        label: clips[0]?.text ?? "",
        clipIds: clips.map((item) => item.id),
        referenceClipId: clips[0]?.id ?? null,
      },
    ],
  };
}

export async function listenStudio() {
  const root = await mkdtemp(path.join(tmpdir(), "krayon-routes-"));
  const state: PythonState = {
    mode: "ok",
    payload: analysisOf([{ id: "py-1", text: "alpha beta", sourceStart: 0.2, sourceEnd: 1.8, groupId: "py-g" }]),
    release: null,
    calls: [],
  };
  const { app, hub } = await buildApp({
    host: "127.0.0.1",
    port: 0,
    corsOrigins: ["http://localhost:5173"],
    pythonBase: "http://127.0.0.1:9",
    projectsDir: root,
  });
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes("127.0.0.1:9")) return original(input, init);
    state.calls.push(url);
    if (url.includes("/render/async")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { outputPath?: string; quality?: string };
      if (body.outputPath) {
        await mkdir(path.dirname(body.outputPath), { recursive: true });
        await writeFile(body.outputPath, Buffer.from("fake-mp4"));
        await writeFile(body.outputPath.replace(/\.mp4$/, ".json"), JSON.stringify({ quality: body.quality ?? "final", duration: 1.25 }));
      }
      return json({ jobId: "render-1" });
    }
    if (url.includes("/jobs/") && url.endsWith("/cancel")) return json({ status: "cancelled" });
    if (url.includes("/analyze/async") || url.includes("/reanalyze/async")) return json({ jobId: "job-1" });
    if (url.includes("/progress/")) return progressResponse(state);
    return json({ ok: true });
  };
  return {
    root,
    app,
    hub,
    base,
    state,
    async close() {
      globalThis.fetch = original;
      await app.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function progressResponse(state: PythonState): Response {
  if (state.mode === "hang") {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          state.release = () => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ phase: "error", message: "stopped", progress: 1 })}\n\n`));
            controller.close();
            state.release = null;
          };
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  }
  if (state.mode === "error") {
    return new Response(`data: ${JSON.stringify({ phase: "error", message: "no transcript", progress: 1 })}\n\n`, {
      headers: { "content-type": "text/event-stream" },
    });
  }
  const events = [
    { phase: "segmenting", progress: 0.4, message: "segmenting" },
    { phase: "complete", progress: 1, message: JSON.stringify(state.payload) },
  ];
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

export async function seedProject(
  root: string,
  slug: string,
  clips: Clip[],
  extra: { order?: string[]; nextClipSeq?: number; script?: string } = {},
) {
  const meta = await createProject(root, slug, slug, extra.script ?? "");
  const groups = new Map<string, string[]>();
  for (const item of clips) {
    const list = groups.get(item.groupId) ?? [];
    list.push(item.id);
    groups.set(item.groupId, list);
  }
  const cuts: Cuts = {
    revision: 0,
    clips,
    groups: [...groups.entries()].map(([id, clipIds]) => ({
      id,
      label: clips.find((item) => item.groupId === id)?.text ?? id,
      clipIds,
      recommendedClipId: clipIds[0] ?? null,
    })),
    order: extra.order ?? clips.filter((item) => item.status === "selected").map((item) => item.id),
    canvasDraft: { version: 1, elements: [] },
  };
  meta.nextClipSeq = extra.nextClipSeq ?? clips.length + 1;
  meta.nextGroupSeq = groups.size + 1;
  meta.status = "ready";
  const source = path.join(root, slug, "source.txt");
  await writeFile(source, "source");
  meta.sourcePath = source;
  const entry = await commitRevision(path.join(root, slug), meta, cuts, "algorithm", "analyze", "seed");
  return entry.revision;
}

export async function http(base: string, method: string, pathname: string, body?: unknown) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body === undefined ? { "x-krayon-actor": "grok" } : { "content-type": "application/json", "x-krayon-actor": "grok" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { status: response.status, payload };
}
