import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { StudioConfig } from "./config.js";
import { adoptAnalysis, type AnalysisPayload } from "./domain/adopt.js";
import { lintCuts } from "./domain/lint.js";
import { applyOps, type Op } from "./domain/ops.js";
import { studioSchema } from "./domain/schema.js";
import {
  type Actor,
  type Clip,
  ConflictError,
  OpError,
  playRanges,
} from "./domain/types.js";
import { EventHub } from "./events.js";
import { pythonJson, startAndWait } from "./python.js";
import {
  commitRevision,
  createProject,
  currentFile,
  listHistory,
  listProjects,
  moveHistory,
  projectDir,
  readCuts,
  readHistory,
  readMeta,
  saveMeta,
  useProject,
  withLock,
} from "./store.js";

const actorSchema = z.enum(["algorithm", "grok", "human"]);

const opSchema = z.custom<Op>((value) => {
  if (!value || typeof value !== "object" || !("op" in value)) return false;
  return typeof (value as { op: unknown }).op === "string";
});

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "project";
}

function actorOf(header: string | undefined, body: unknown): Actor {
  const fromBody =
    body && typeof body === "object" && "actor" in body ? String((body as { actor: unknown }).actor) : undefined;
  const parsed = actorSchema.safeParse(fromBody ?? header ?? "human");
  return parsed.success ? parsed.data : "human";
}

function clipSummary(clip: Clip) {
  return {
    id: clip.id,
    parentIds: clip.parentIds,
    sourceStart: clip.sourceStart,
    sourceEnd: clip.sourceEnd,
    ranges: clip.ranges,
    duration: clip.duration,
    text: clip.text,
    wordCount: clip.words.length,
    groupId: clip.groupId,
    label: clip.label,
    score: clip.score,
    reasons: clip.reasons,
    status: clip.status,
    decidedBy: clip.decidedBy,
    note: clip.note,
  };
}

function toPythonClip(clip: Clip, index: number) {
  return {
    id: clip.id,
    index,
    sourceStart: clip.sourceStart,
    sourceEnd: clip.sourceEnd,
    duration: clip.duration,
    text: clip.text,
    groupId: clip.groupId,
    words: clip.words,
    falseStart: clip.label === "falseStart",
    deliveryIssue: clip.label !== "none" && clip.label !== "falseStart" ? clip.label : null,
    ranges: playRanges(clip),
  };
}

async function load(root: string, slug: string) {
  const dir = projectDir(root, slug);
  const meta = await readMeta(dir);
  const cuts = await readCuts(dir);
  return { dir, meta, cuts };
}

export function registerRoutes(
  app: FastifyInstance,
  deps: { config: StudioConfig; hub: EventHub },
): void {
  const root = deps.config.projectsDir;
  const python = deps.config.pythonBase;

  app.get("/api/studio/health", async () => ({ status: "ok" }));
  app.get("/api/studio/schema", async () => studioSchema);

  app.get("/api/studio/projects", async () => {
    const projects = await listProjects(root);
    return { projects, current: await currentFile(root) };
  });

  app.post("/api/studio/projects", async (request, reply) => {
    const body = z.object({ title: z.string().optional(), slug: z.string().optional() }).parse(request.body ?? {});
    const title = body.title?.trim() || "Untitled";
    let slug = body.slug ? slugify(body.slug) : slugify(title);
    const existing = new Set((await listProjects(root)).map((item) => item.slug));
    if (existing.has(slug)) {
      let n = 2;
      while (existing.has(`${slug}-${n}`)) n += 1;
      slug = `${slug}-${n}`;
    }
    const meta = await createProject(root, slug, title);
    return reply.code(201).send(meta);
  });

  app.post("/api/studio/projects/use", async (request) => {
    const body = z.object({ slug: z.string() }).parse(request.body);
    await useProject(root, slugify(body.slug));
    return { current: slugify(body.slug) };
  });

  app.get("/api/studio/projects/:slug", async (request) => {
    const { slug } = request.params as { slug: string };
    const { meta, cuts } = await load(root, slug);
    return {
      meta,
      revision: meta.revision,
      status: meta.status,
      clips: cuts.clips,
      groups: cuts.groups,
      order: cuts.order,
      canvasDraft: cuts.canvasDraft,
      history: await listHistory(projectDir(root, slug), meta),
    };
  });

  app.post("/api/studio/pick-file", async () => pythonJson(python, "/api/audio-studio/pick-file", {}));

  app.post("/api/studio/projects/:slug/import", async (request) => {
    const { slug } = request.params as { slug: string };
    return withLock(slug, async () => {
      const { dir, meta } = await load(root, slug);
      let sourcePath: string | null = null;
      if (request.isMultipart()) {
        const file = await request.file();
        if (!file) throw new OpError([{ clipId: null, field: "file", message: "Missing file" }]);
        const imported = path.join(dir, "imported");
        await mkdir(imported, { recursive: true });
        const safeName = path.basename(file.filename || "source.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
        sourcePath = path.join(imported, safeName);
        await pipeline(file.file, createWriteStream(sourcePath));
      } else {
        const body = z.object({ path: z.string().min(1) }).parse(request.body);
        sourcePath = path.resolve(body.path);
        const info = await stat(sourcePath);
        if (!info.isFile()) throw new OpError([{ clipId: null, field: "path", message: "Source is not a file" }]);
      }
      meta.sourcePath = sourcePath;
      meta.status = "empty";
      meta.statusMessage = "Ready to analyze";
      await saveMeta(dir, meta);
      deps.hub.publish(slug, { type: "status", status: meta.status, message: meta.statusMessage });
      return { sourcePath };
    });
  });

  app.post("/api/studio/projects/:slug/analyze", async (request) => {
    const { slug } = request.params as { slug: string };
    const body = (request.body ?? {}) as { baseRevision?: number; silenceThreshold?: number; pad?: number; similarityThreshold?: number; language?: string };
    const actor = actorOf(request.headers["x-krayon-actor"] as string | undefined, body);
    return withLock(slug, async () => {
      const { dir, meta, cuts } = await load(root, slug);
      if (body.baseRevision != null && body.baseRevision !== meta.revision) {
        throw new ConflictError(meta.revision, body.baseRevision);
      }
      if (!meta.sourcePath) throw new OpError([{ clipId: null, field: "source", message: "Import a video first" }]);
      meta.status = "analyzing";
      meta.statusMessage = "Starting analysis";
      await saveMeta(dir, meta);
      const initial = cuts.clips.length === 0;
      try {
        const result = await startAndWait<AnalysisPayload>(
          python,
          "/api/audio-studio/analyze/async",
          {
            sourcePath: meta.sourcePath,
            analysisDir: path.join(dir, "analysis"),
            silenceThreshold: body.silenceThreshold ?? 0.4,
            pad: body.pad ?? 0.05,
            similarityThreshold: body.similarityThreshold ?? 0.7,
            language: body.language ?? "en",
          },
          (event) => {
            deps.hub.publish(slug, {
              type: "progress",
              phase: event.phase,
              message: event.message,
              ratio: event.progress,
            });
          },
        );
        const ids = { nextClipSeq: meta.nextClipSeq, nextGroupSeq: meta.nextGroupSeq };
        const adopted = adoptAnalysis(cuts, ids, result, { initial });
        meta.nextClipSeq = ids.nextClipSeq;
        meta.nextGroupSeq = ids.nextGroupSeq;
        meta.status = "ready";
        meta.statusMessage = `Analyzed ${adopted.doc.clips.length} clips`;
        const entry = await commitRevision(dir, meta, adopted.doc, actor, "analyze", meta.statusMessage);
        deps.hub.publish(slug, {
          type: "revision",
          revision: entry.revision,
          actor,
          label: entry.label,
          summary: entry.summary,
        });
        return { revision: entry.revision, clipCount: adopted.doc.clips.length, summary: entry.summary };
      } catch (error) {
        meta.status = "error";
        meta.statusMessage = error instanceof Error ? error.message : "Analysis failed";
        await saveMeta(dir, meta);
        deps.hub.publish(slug, { type: "status", status: "error", message: meta.statusMessage });
        throw error;
      }
    });
  });

  app.get("/api/studio/projects/:slug/clips", async (request) => {
    const { slug } = request.params as { slug: string };
    const query = request.query as { group?: string; label?: string; status?: string };
    const { cuts } = await load(root, slug);
    const clips = cuts.clips.filter((clip) => {
      if (query.group && clip.groupId !== query.group) return false;
      if (query.label && clip.label !== query.label) return false;
      if (query.status && clip.status !== query.status) return false;
      return true;
    });
    return { revision: cuts.revision, clips: clips.map(clipSummary) };
  });

  app.get("/api/studio/projects/:slug/clips/:id", async (request) => {
    const { slug, id } = request.params as { slug: string; id: string };
    const { cuts } = await load(root, slug);
    const clip = cuts.clips.find((item) => item.id === id);
    if (!clip) throw new OpError([{ clipId: id, field: "id", message: `Unknown clip ${id}`, allowed: cuts.clips.map((item) => item.id) }]);
    const ordered = [...cuts.clips].sort((a, b) => a.sourceStart - b.sourceStart);
    const index = ordered.findIndex((item) => item.id === id);
    const group = cuts.groups.find((item) => item.id === clip.groupId) ?? null;
    return {
      clip,
      words: clip.words,
      neighbours: {
        previous: ordered[index - 1]?.id ?? null,
        next: ordered[index + 1]?.id ?? null,
      },
      group,
      groupMates: cuts.clips.filter((item) => item.groupId === clip.groupId && item.id !== clip.id).map(clipSummary),
      reasoning: { score: clip.score, reasons: clip.reasons, label: clip.label },
    };
  });

  app.get("/api/studio/projects/:slug/clips/:id/transcript", async (request) => {
    const { slug, id } = request.params as { slug: string; id: string };
    const { cuts } = await load(root, slug);
    const clip = cuts.clips.find((item) => item.id === id);
    if (!clip) throw new OpError([{ clipId: id, field: "id", message: `Unknown clip ${id}` }]);
    return { id: clip.id, text: clip.text, words: clip.words };
  });

  app.get("/api/studio/projects/:slug/clips/:id/audio.wav", async (request, reply) => {
    const { slug, id } = request.params as { slug: string; id: string };
    const pad = Number((request.query as { pad?: string }).pad ?? 0);
    const { dir, cuts } = await load(root, slug);
    const clip = cuts.clips.find((item) => item.id === id);
    if (!clip) throw new OpError([{ clipId: id, field: "id", message: `Unknown clip ${id}` }]);
    const wav = path.join(dir, "analysis", "source.wav");
    const ranges = playRanges(clip).map((range) => `${range.sourceStart},${range.sourceEnd}`).join(";");
    const url = new URL("/api/audio-studio/clip-audio", python);
    url.searchParams.set("wav", wav);
    url.searchParams.set("ranges", ranges);
    url.searchParams.set("pad", String(Number.isFinite(pad) ? pad : 0));
    const response = await fetch(url);
    if (!response.ok) throw new Error(await response.text());
    reply.header("content-type", "audio/wav");
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });

  app.get("/api/studio/projects/:slug/clips/:id/frame.png", async (request, reply) => {
    const { slug, id } = request.params as { slug: string; id: string };
    const at = Number((request.query as { at?: string }).at ?? NaN);
    const { meta, cuts } = await load(root, slug);
    const clip = cuts.clips.find((item) => item.id === id);
    if (!clip) throw new OpError([{ clipId: id, field: "id", message: `Unknown clip ${id}` }]);
    if (!meta.sourcePath) throw new OpError([{ clipId: id, field: "source", message: "No source video" }]);
    const time = Number.isFinite(at) ? at : clip.sourceStart;
    const url = new URL("/api/audio-studio/frame.png", python);
    url.searchParams.set("source", meta.sourcePath);
    url.searchParams.set("at", String(time));
    const response = await fetch(url);
    if (!response.ok) throw new Error(await response.text());
    reply.header("content-type", "image/png");
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });

  app.post("/api/studio/projects/:slug/ops", async (request) => {
    const { slug } = request.params as { slug: string };
    const body = z
      .object({
        baseRevision: z.number().int(),
        actor: actorSchema.optional(),
        label: z.string().optional(),
        ops: z.array(opSchema).min(1),
      })
      .parse(request.body);
    const actor = actorOf(request.headers["x-krayon-actor"] as string | undefined, body);
    return withLock(slug, async () => {
      const { dir, meta, cuts } = await load(root, slug);
      if (body.baseRevision !== meta.revision) throw new ConflictError(meta.revision, body.baseRevision);
      const ids = { nextClipSeq: meta.nextClipSeq, nextGroupSeq: meta.nextGroupSeq };
      const applied = applyOps(cuts, ids, body.ops, actor);
      meta.nextClipSeq = ids.nextClipSeq;
      meta.nextGroupSeq = ids.nextGroupSeq;
      const entry = await commitRevision(dir, meta, applied.doc, actor, body.label ?? "edit", applied.summary);
      deps.hub.publish(slug, {
        type: "revision",
        revision: entry.revision,
        actor,
        label: entry.label,
        summary: entry.summary,
      });
      return { revision: entry.revision, summary: entry.summary, order: applied.doc.order };
    });
  });

  app.post("/api/studio/projects/:slug/reanalyze", async (request) => {
    const { slug } = request.params as { slug: string };
    const body = z
      .object({
        baseRevision: z.number().int(),
        actor: actorSchema.optional(),
        label: z.string().optional(),
        mode: z.enum(["retranscribe", "resegment", "regroup"]),
        clipIds: z.array(z.string()).optional(),
        rangeStart: z.number().optional(),
        rangeEnd: z.number().optional(),
        silenceThreshold: z.number().optional(),
        pad: z.number().optional(),
        similarityThreshold: z.number().optional(),
      })
      .parse(request.body);
    const actor = actorOf(request.headers["x-krayon-actor"] as string | undefined, body);
    return withLock(slug, async () => {
      const { dir, meta, cuts } = await load(root, slug);
      if (body.baseRevision !== meta.revision) throw new ConflictError(meta.revision, body.baseRevision);
      if (!meta.sourcePath) throw new OpError([{ clipId: null, field: "source", message: "Import a video first" }]);
      const chosen = body.clipIds?.map((id) => cuts.clips.find((clip) => clip.id === id)).filter((clip): clip is Clip => clip != null) ?? [];
      if (body.clipIds && chosen.length !== body.clipIds.length) {
        throw new OpError([{ clipId: body.clipIds[0] ?? null, field: "clipIds", message: "Unknown clip id", allowed: cuts.clips.map((clip) => clip.id) }]);
      }
      const rangeStart = body.rangeStart ?? (chosen.length ? Math.min(...chosen.map((clip) => clip.sourceStart)) : undefined);
      const rangeEnd = body.rangeEnd ?? (chosen.length ? Math.max(...chosen.map((clip) => clip.sourceEnd)) : undefined);
      meta.status = "analyzing";
      meta.statusMessage = body.mode;
      await saveMeta(dir, meta);
      const result = await startAndWait<AnalysisPayload>(
        python,
        "/api/audio-studio/reanalyze/async",
        {
          sourcePath: meta.sourcePath,
          analysisDir: path.join(dir, "analysis"),
          mode: body.mode,
          rangeStart,
          rangeEnd,
          silenceThreshold: body.silenceThreshold ?? 0.4,
          pad: body.pad ?? 0.05,
          similarityThreshold: body.similarityThreshold ?? 0.7,
          clips: cuts.clips.map(toPythonClip),
        },
        (event) => deps.hub.publish(slug, { type: "progress", phase: event.phase, message: event.message, ratio: event.progress }),
      );
      const ids = { nextClipSeq: meta.nextClipSeq, nextGroupSeq: meta.nextGroupSeq };
      const adopted = adoptAnalysis(cuts, ids, { ...result, rangeStart: result.rangeStart ?? rangeStart, rangeEnd: result.rangeEnd ?? rangeEnd }, {
        regroup: body.mode === "regroup",
      });
      meta.nextClipSeq = ids.nextClipSeq;
      meta.nextGroupSeq = ids.nextGroupSeq;
      meta.status = "ready";
      meta.statusMessage = adopted.retired.length ? `Retired ${adopted.retired.join(", ")}` : "Reanalysis kept clip ids";
      const entry = await commitRevision(dir, meta, adopted.doc, actor, body.label ?? body.mode, meta.statusMessage);
      deps.hub.publish(slug, { type: "revision", revision: entry.revision, actor, label: entry.label, summary: entry.summary });
      return { revision: entry.revision, summary: entry.summary, created: adopted.created, retired: adopted.retired };
    });
  });

  app.get("/api/studio/projects/:slug/lint", async (request) => {
    const { slug } = request.params as { slug: string };
    const { cuts } = await load(root, slug);
    return { revision: cuts.revision, warnings: lintCuts(cuts) };
  });

  app.get("/api/studio/projects/:slug/history", async (request) => {
    const { slug } = request.params as { slug: string };
    const { dir, meta } = await load(root, slug);
    return { revision: meta.revision, head: meta.head, history: await listHistory(dir, meta) };
  });

  app.post("/api/studio/projects/:slug/undo", async (request) => {
    const { slug } = request.params as { slug: string };
    return withLock(slug, async () => shift(slug, "undo"));
  });

  app.post("/api/studio/projects/:slug/redo", async (request) => {
    const { slug } = request.params as { slug: string };
    return withLock(slug, async () => shift(slug, "redo"));
  });

  app.post("/api/studio/projects/:slug/restore", async (request) => {
    const { slug } = request.params as { slug: string };
    const body = z.object({ revision: z.number().int(), actor: actorSchema.optional(), label: z.string().optional() }).parse(request.body);
    const actor = actorOf(request.headers["x-krayon-actor"] as string | undefined, body);
    return withLock(slug, async () => {
      const { dir, meta } = await load(root, slug);
      const entry = await readHistory(dir, body.revision);
      const copy = structuredClone(entry.cuts);
      const saved = await commitRevision(dir, meta, copy, actor, body.label ?? "restore", `restored revision ${body.revision}`);
      deps.hub.publish(slug, { type: "revision", revision: saved.revision, actor, label: saved.label, summary: saved.summary });
      return { revision: saved.revision, summary: saved.summary };
    });
  });

  async function shift(slug: string, direction: "undo" | "redo") {
    const { dir, meta } = await load(root, slug);
    const cuts = await moveHistory(dir, meta, direction);
    deps.hub.publish(slug, {
      type: "revision",
      revision: meta.revision,
      actor: "human",
      label: direction,
      summary: direction,
    });
    return { revision: meta.revision, order: cuts.order };
  }

  const renders = new Map<string, { id: string; status: string; ratio: number; message: string; outputName?: string }>();

  app.post("/api/studio/projects/:slug/render", async (request) => {
    const { slug } = request.params as { slug: string };
    const body = z.object({ quality: z.enum(["preview", "final"]).default("final") }).parse(request.body ?? {});
    const { dir, meta, cuts } = await load(root, slug);
    if (!meta.sourcePath) throw new OpError([{ clipId: null, field: "source", message: "Import a video first" }]);
    const selected = cuts.order
      .map((id) => cuts.clips.find((clip) => clip.id === id))
      .filter((clip): clip is Clip => clip != null && clip.status === "selected");
    if (selected.length === 0) {
      throw new OpError([{ clipId: null, field: "order", message: "Select at least one clip before rendering" }]);
    }
    const renderId = `${body.quality}-${cuts.revision}-${Date.now()}`;
    const outputName = `${renderId}.mp4`;
    renders.set(renderId, { id: renderId, status: "rendering", ratio: 0, message: "Starting render" });
    meta.status = "rendering";
    await saveMeta(dir, meta);
    void startAndWait(
      python,
      "/api/audio-studio/render/async",
      {
        sourcePath: meta.sourcePath,
        outputPath: path.join(dir, "output", outputName),
        quality: body.quality,
        clips: selected.map((clip) => ({ id: clip.id, ranges: playRanges(clip) })),
      },
      (event) => {
        const job = renders.get(renderId);
        if (job) {
          job.ratio = event.progress ?? job.ratio;
          job.message = event.message ?? job.message;
        }
        deps.hub.publish(slug, { type: "render", renderId, phase: "rendering", ratio: event.progress, message: event.message });
      },
    )
      .then(async () => {
        const job = renders.get(renderId);
        if (job) {
          job.status = "done";
          job.ratio = 1;
          job.outputName = outputName;
          job.message = "Render complete";
        }
        const latest = await readMeta(dir);
        latest.status = "ready";
        latest.statusMessage = `Rendered ${outputName}`;
        await saveMeta(dir, latest);
        deps.hub.publish(slug, { type: "render", renderId, phase: "done", ratio: 1, message: "Render complete", outputName });
      })
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : "Render failed";
        const job = renders.get(renderId);
        if (job) {
          job.status = "error";
          job.message = message;
        }
        deps.hub.publish(slug, { type: "render", renderId, phase: "error", message });
      });
    return { renderId, outputName };
  });

  app.get("/api/studio/projects/:slug/render/:id", async (request) => {
    const { id } = request.params as { id: string };
    const job = renders.get(id);
    if (!job) throw new OpError([{ clipId: null, field: "renderId", message: `Unknown render ${id}` }]);
    return job;
  });

  app.get("/api/studio/projects/:slug/output", async (request) => {
    const { slug } = request.params as { slug: string };
    const dir = projectDir(root, slug);
    const { readdir: readDir, readFile: readText } = { readdir, readFile };
    const names = await readDir(path.join(dir, "output")).catch(() => [] as string[]);
    const manifests = [];
    for (const name of names.filter((item) => item.endsWith(".json"))) {
      manifests.push(JSON.parse(await readText(path.join(dir, "output", name), "utf8")));
    }
    return { files: names, manifests };
  });

  app.get("/api/studio/projects/:slug/media/source", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { meta } = await load(root, slug);
    if (!meta.sourcePath) throw new OpError([{ clipId: null, field: "source", message: "No source video" }]);
    return sendFile(request, reply, meta.sourcePath);
  });

  app.get("/api/studio/projects/:slug/media/output/:name", async (request, reply) => {
    const { slug, name } = request.params as { slug: string; name: string };
    if (name.includes("..") || name.includes("/")) {
      throw new OpError([{ clipId: null, field: "name", message: "Invalid output name" }]);
    }
    return sendFile(request, reply, path.join(projectDir(root, slug), "output", name));
  });

  app.get("/api/studio/projects/:slug/events", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { meta } = await load(root, slug);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    send({ type: "snapshot", revision: meta.revision, status: meta.status, message: meta.statusMessage });
    const unsubscribe = deps.hub.subscribe(slug, (event) => send(event));
    const timer = setInterval(() => reply.raw.write(": ping\n\n"), 15000);
    request.raw.on("close", () => {
      clearInterval(timer);
      unsubscribe();
    });
  });
}

async function sendFile(request: FastifyRequest, reply: FastifyReply, filePath: string) {
  const info = await stat(filePath);
  const rangeHeader = request.headers.range;
  reply.header("Accept-Ranges", "bytes");
  reply.header("Content-Type", filePath.endsWith(".mp4") ? "video/mp4" : "application/octet-stream");
  if (rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (!match) throw new OpError([{ clipId: null, field: "range", message: "Invalid range" }]);
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : info.size - 1;
    reply.code(206);
    reply.header("Content-Range", `bytes ${start}-${end}/${info.size}`);
    reply.header("Content-Length", String(end - start + 1));
    return reply.send(createReadStream(filePath, { start, end }));
  }
  reply.header("Content-Length", String(info.size));
  return reply.send(createReadStream(filePath));
}

export function errorBody(error: unknown): { status: number; body: unknown } | null {
  if (error instanceof OpError) {
    return { status: 400, body: { error: "validation", message: error.message, errors: error.errors } };
  }
  if (error instanceof ConflictError) {
    return {
      status: 409,
      body: { error: "conflict", message: error.message, currentRevision: error.currentRevision },
    };
  }
  if (error instanceof z.ZodError) {
    return { status: 400, body: { error: "validation", message: "Invalid request", errors: error.issues } };
  }
  if (error instanceof Error && (error.message === "Nothing to undo" || error.message === "Nothing to redo")) {
    return { status: 400, body: { error: "validation", message: error.message, errors: [] } };
  }
  return null;
}
