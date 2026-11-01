import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { StudioConfig } from "./config.js";
import { adoptAnalysis, type AnalysisPayload } from "./domain/adopt.js";
import { lintCuts, type AudioEdgeStats } from "./domain/lint.js";
import { notifyConfirmation, waitForConfirmation } from "./confirm-waiters.js";
import {
  type ConfirmationItem,
  mintConfirmation,
  readConfirmations,
  validateConfirmationInput,
  writeConfirmations,
} from "./domain/confirmations.js";
import { applyOps, type Op } from "./domain/ops.js";
import { studioSchema } from "./domain/schema.js";
import {
  type Actor,
  type Clip,
  BusyError,
  ConflictError,
  InvalidSlugError,
  NameConflictError,
  NotFoundError,
  OpError,
  playRanges,
  throwIfBusy,
} from "./domain/types.js";
import { EventHub } from "./events.js";
import { checkNameAvailability, slugifyName } from "./names.js";
import { cancelPythonJob, pythonJson, startPythonJob, waitForPythonJob } from "./python.js";
import {
  assertProjectPath,
  clearCurrent,
  commitRevision,
  countScriptLines,
  createProject,
  currentFile,
  deleteProjectDir,
  listHistory,
  listProjects,
  moveHistory,
  projectDir,
  projectExists,
  readCuts,
  readHistory,
  readJobCheckpoint,
  readMeta,
  readScript,
  resetProjectStatus,
  resolvedPipeline,
  DEFAULT_SETTINGS,
  normalizeScriptText,
  normalizeSettings,
  saveMeta,
  useProject,
  withLock,
  writeScript,
  type PipelineMode,
} from "./store.js";

const actorSchema = z.enum(["algorithm", "grok", "human"]);

const opSchema = z.custom<Op>((value) => {
  if (!value || typeof value !== "object" || !("op" in value)) return false;
  return typeof (value as { op: unknown }).op === "string";
});

function slugify(input: string): string {
  return slugifyName(input) || "project";
}

function actorOf(header: string | undefined, body: unknown): Actor {
  const fromBody =
    body && typeof body === "object" && "actor" in body ? String((body as { actor: unknown }).actor) : undefined;
  const parsed = actorSchema.safeParse(fromBody ?? header ?? "human");
  return parsed.success ? parsed.data : "human";
}

function pythonSettings(meta: { settings?: typeof DEFAULT_SETTINGS }, body: Record<string, unknown> = {}) {
  const settings = meta.settings ?? DEFAULT_SETTINGS;
  return {
    silenceThreshold: (body.silenceThreshold as number | undefined) ?? settings.silenceThreshold ?? DEFAULT_SETTINGS.silenceThreshold,
    pad: (body.pad as number | undefined) ?? settings.pad ?? DEFAULT_SETTINGS.pad,
    similarityThreshold:
      (body.similarityThreshold as number | undefined) ?? settings.similarityThreshold ?? DEFAULT_SETTINGS.similarityThreshold,
    snapToAudio: settings.snapToAudio ?? DEFAULT_SETTINGS.snapToAudio,
    snapSearchSeconds: settings.snapSearchSeconds ?? DEFAULT_SETTINGS.snapSearchSeconds,
    scriptMatchThreshold: settings.scriptMatchThreshold ?? DEFAULT_SETTINGS.scriptMatchThreshold,
    scriptConfirmThreshold: settings.scriptConfirmThreshold ?? DEFAULT_SETTINGS.scriptConfirmThreshold,
    scriptPreferLastTakes: settings.scriptPreferLastTakes ?? DEFAULT_SETTINGS.scriptPreferLastTakes,
    scriptWhisperPrompt: settings.scriptWhisperPrompt ?? DEFAULT_SETTINGS.scriptWhisperPrompt,
  };
}

async function enqueueScriptConfirms(
  dir: string,
  cuts: { clips: Clip[] },
  threshold: number,
  createdBy: Actor,
) {
  const file = await readConfirmations(dir);
  for (const clip of cuts.clips) {
    if (clip.status !== "selected" || !clip.script) continue;
    if (clip.script.score >= threshold) continue;
    const line = clip.script.line;
    const pending = file.items.some(
      (item) =>
        item.status === "pending" &&
        (item.clipIds.includes(clip.id) || item.title.startsWith(`line ${line}:`)),
    );
    if (pending) continue;
    mintConfirmation(
      file,
      {
        kind: "confirm",
        title: `line ${line}: match ${clip.script.score.toFixed(2)}, please check`,
        message: clip.script.text,
        clipIds: [clip.id],
        options: [{ id: "checked", label: "Checked", style: "primary", applyOps: false }],
      },
      createdBy,
    );
  }
  await writeConfirmations(dir, file);
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
    statusReason: clip.statusReason,
    statusAt: clip.statusAt,
    note: clip.note,
    llm: clip.llm,
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
  try {
    const meta = await readMeta(dir);
    const cuts = await readCuts(dir);
    return { dir, meta, cuts };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
    if (code === "ENOENT") throw new NotFoundError(`Unknown project ${slug}`);
    throw error;
  }
}

export function registerRoutes(
  app: FastifyInstance,
  deps: { config: StudioConfig; hub: EventHub },
): void {
  const root = deps.config.projectsDir;
  const python = deps.config.pythonBase;

  const deletedSlugs = new Set<string>();
  const analyses = new Map<
    string,
    { pythonJobId: string; generation: number; wait: Promise<unknown> }
  >();
  const renders = new Map<
    string,
    { id: string; slug: string; status: string; ratio: number; message: string; outputName?: string; pythonJobId?: string }
  >();

  function isDeleted(slug: string): boolean {
    return deletedSlugs.has(slug);
  }

  async function claimAnalysis(slug: string, baseRevision: number | undefined, message: string) {
    if (isDeleted(slug)) throw new NotFoundError(`Unknown project ${slug}`);
    return withLock(slug, async () => {
      const loaded = await load(root, slug);
      throwIfBusy(loaded.meta.status);
      if (baseRevision != null && baseRevision !== loaded.meta.revision) {
        throw new ConflictError(loaded.meta.revision, baseRevision);
      }
      if (!loaded.meta.sourcePath) throw new OpError([{ clipId: null, field: "source", message: "Import a video first" }]);
      loaded.meta.status = "analyzing";
      loaded.meta.statusMessage = message;
      loaded.meta.analysisStartedAt = new Date().toISOString();
      loaded.meta.lastPhase = "extracting";
      loaded.meta.lastPhaseMessage = message;
      loaded.meta.lastPhaseRatio = 0;
      await saveMeta(loaded.dir, loaded.meta);
      return loaded;
    });
  }

  async function failAnalysis(slug: string, message: string) {
    if (isDeleted(slug)) return;
    await withLock(slug, async () => {
      if (isDeleted(slug)) return;
      try {
        const loaded = await load(root, slug);
        if (loaded.meta.status !== "analyzing") return;
        loaded.meta.status = "error";
        loaded.meta.statusMessage = message;
        await saveMeta(loaded.dir, loaded.meta);
      } catch (error) {
        if (error instanceof NotFoundError) return;
        throw error;
      }
    });
  }

  async function recordProgress(slug: string, phase?: string, message?: string, ratio?: number) {
    if (!phase || isDeleted(slug)) return;
    deps.hub.publish(slug, { type: "progress", phase, message, ratio });
    await withLock(slug, async () => {
      if (isDeleted(slug)) return;
      try {
        const loaded = await load(root, slug);
        loaded.meta.lastPhase = phase;
        loaded.meta.lastPhaseMessage = message ?? loaded.meta.lastPhaseMessage;
        loaded.meta.lastPhaseRatio = typeof ratio === "number" ? ratio : loaded.meta.lastPhaseRatio;
        await saveMeta(loaded.dir, loaded.meta);
      } catch (error) {
        if (error instanceof NotFoundError) return;
        throw error;
      }
    });
  }

  async function runPythonAnalysis<T>(
    slug: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    const started = await startPythonJob(python, path, body);
    const generation = Date.now();
    const wait = waitForPythonJob<T>(python, started.jobId, {
      onProgress: (event) => {
        void recordProgress(slug, event.phase, event.message, event.progress);
      },
    });
    analyses.set(slug, { pythonJobId: started.jobId, generation, wait });
    try {
      return await wait;
    } finally {
      const current = analyses.get(slug);
      if (current?.generation === generation) analyses.delete(slug);
    }
  }

  async function cancelJobsForSlug(slug: string): Promise<void> {
    const analysis = analyses.get(slug);
    if (analysis) {
      await cancelPythonJob(python, analysis.pythonJobId);
      const stopped = await Promise.race([
        analysis.wait.then(
          () => true,
          () => true,
        ),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000)),
      ]);
      if (!stopped) {
        throw new BusyError("Could not stop the running analysis. Try again after it finishes or after reset-status.");
      }
    }
    for (const [id, job] of [...renders.entries()]) {
      if (job.slug !== slug) continue;
      if (job.pythonJobId) await cancelPythonJob(python, job.pythonJobId);
      job.status = "cancelled";
      const stopped = job.status === "cancelled";
      if (!stopped) {
        throw new BusyError("Could not stop the running render. Cancel it first, then delete.");
      }
      renders.delete(id);
    }
  }

  async function cancelPendingConfirmations(slug: string): Promise<void> {
    try {
      const dir = projectDir(root, slug);
      const file = await readConfirmations(dir);
      for (const item of file.items) {
        clearExpiry(slug, item.id);
        if (item.status !== "pending") continue;
        item.status = "cancelled";
        item.result = { applied: false, revision: null, error: "deleted" };
        publishConfirmation(slug, "confirmation_cancelled", item);
      }
    } catch {
      /* project may already be gone */
    }
  }

  async function destroyProject(slug: string): Promise<void> {
    let parsed: string;
    try {
      parsed = assertProjectPath(root, slug);
    } catch {
      throw new InvalidSlugError("Invalid project slug");
    }
    if (!(await projectExists(root, slug))) throw new NotFoundError(`Unknown project ${slug}`);
    await cancelJobsForSlug(slug);
    await cancelPendingConfirmations(slug);
    deletedSlugs.add(slug);
    deps.hub.publish(slug, { type: "deleted", message: "Project deleted" });
    deps.hub.drop(slug);
    await withLock(slug, async () => {
      await deleteProjectDir(root, slug);
    });
    void parsed;
  }

  async function audioStatsFor(dir: string, clip: Clip): Promise<AudioEdgeStats | null> {
    const wav = path.join(dir, "analysis", "source.wav");
    try {
      await stat(wav);
    } catch {
      return null;
    }
    const ranges = playRanges(clip).map((range) => `${range.sourceStart},${range.sourceEnd}`).join(";");
    const url = new URL("/api/audio-studio/audio-stats", python);
    url.searchParams.set("wav", wav);
    url.searchParams.set("ranges", ranges);
    const response = await fetch(url).catch(() => null);
    if (!response || !response.ok) return null;
    return (await response.json()) as AudioEdgeStats;
  }

  const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function timerKey(slug: string, id: string) {
    return `${slug}:${id}`;
  }

  function clearExpiry(slug: string, id: string) {
    const key = timerKey(slug, id);
    const timer = expiryTimers.get(key);
    if (timer) clearTimeout(timer);
    expiryTimers.delete(key);
  }

  async function postCallback(item: ConfirmationItem) {
    if (!item.callbackUrl) return;
    try {
      await fetch(item.callbackUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(item),
        signal: AbortSignal.timeout(3000),
      });
    } catch (error) {
      console.error("confirmation callback failed", item.id, error instanceof Error ? error.message : error);
    }
  }

  function publishConfirmation(slug: string, type: "confirmation_created" | "confirmation_resolved" | "confirmation_cancelled", item: ConfirmationItem) {
    deps.hub.publish(slug, {
      type,
      id: item.id,
      status: item.status,
      optionId: item.answer?.optionId,
      result: item.result,
    });
    if (type !== "confirmation_created") notifyConfirmation(item);
    if (type !== "confirmation_created") void postCallback(item);
  }

  async function expireItem(slug: string, id: string) {
    await withLock(slug, async () => {
      const { dir } = await load(root, slug);
      const file = await readConfirmations(dir);
      const item = file.items.find((entry) => entry.id === id);
      if (!item || item.status !== "pending") return;
      item.status = "expired";
      item.result = { applied: false, revision: null, error: "expired" };
      await writeConfirmations(dir, file);
      publishConfirmation(slug, "confirmation_resolved", item);
    });
  }

  function armExpiry(slug: string, item: ConfirmationItem) {
    if (item.status !== "pending" || !item.expiresAt) return;
    const due = Date.parse(item.expiresAt) - Date.now();
    if (due <= 0) {
      void expireItem(slug, item.id);
      return;
    }
    clearExpiry(slug, item.id);
    expiryTimers.set(
      timerKey(slug, item.id),
      setTimeout(() => {
        void expireItem(slug, item.id);
      }, due),
    );
  }

  void listProjects(root).then(async (projects) => {
    for (const meta of projects) {
      const file = await readConfirmations(projectDir(root, meta.slug));
      for (const item of file.items) armExpiry(meta.slug, item);
    }
  });

  app.addHook("onClose", async () => {
    for (const timer of expiryTimers.values()) clearTimeout(timer);
    expiryTimers.clear();
  });

  app.get("/api/studio/health", async () => ({ status: "ok", projectsDir: root }));
  app.get("/api/studio/schema", async () => studioSchema);

  app.get("/api/studio/projects", async () => {
    const projects = await listProjects(root);
    return { projects, current: await currentFile(root) };
  });

  app.get("/api/studio/projects/check-name", async (request) => {
    const name = String((request.query as { name?: string }).name ?? "");
    const existing = await listProjects(root);
    const checked = checkNameAvailability(existing, name);
    return { available: checked.available, reason: checked.reason };
  });

  app.post("/api/studio/projects", async (request, reply) => {
    const body = z
      .object({ title: z.string().optional(), slug: z.string().optional(), script: z.string().optional() })
      .parse(request.body ?? {});
    return withLock("__create__", async () => {
      const existing = await listProjects(root);
      const checked = checkNameAvailability(existing, body.title ?? "", body.slug);
      if (!checked.available || !checked.title || !checked.slug) {
        if (checked.reason?.includes("already exists")) throw new NameConflictError(body.title?.trim() || "");
        throw new OpError([{ clipId: null, field: "title", message: checked.reason ?? "Invalid project name" }]);
      }
      const meta = await createProject(root, checked.slug, checked.title, body.script ?? "");
      return reply.code(201).send(meta);
    });
  });

  app.delete("/api/studio/projects", async (request) => {
    const query = request.query as { confirm?: string };
    const body = (request.body ?? {}) as { confirm?: string };
    if ((body.confirm ?? query.confirm) !== "delete-all") {
      throw new OpError([{ clipId: null, field: "confirm", message: 'Pass confirm: "delete-all" to delete every project' }]);
    }
    const projects = await listProjects(root);
    const deleted: string[] = [];
    const skipped: Array<{ slug: string; reason: string }> = [];
    for (const meta of projects) {
      try {
        await destroyProject(meta.slug);
        deleted.push(meta.slug);
      } catch (error) {
        skipped.push({ slug: meta.slug, reason: error instanceof Error ? error.message : "Could not delete" });
      }
    }
    await clearCurrent(root);
    return { deleted, skipped };
  });

  app.delete("/api/studio/projects/:slug", async (request) => {
    const { slug } = request.params as { slug: string };
    await destroyProject(slug);
    return { deleted: slug };
  });

  app.post("/api/studio/projects/use", async (request) => {
    const body = z.object({ slug: z.string() }).parse(request.body);
    await useProject(root, slugify(body.slug));
    return { current: slugify(body.slug) };
  });

  app.get("/api/studio/projects/:slug", async (request) => {
    const { slug } = request.params as { slug: string };
    const { dir, meta, cuts } = await load(root, slug);
    const checkpoint = await readJobCheckpoint(dir);
    return {
      meta,
      revision: meta.revision,
      status: meta.status,
      lastPhase: checkpoint?.phase ?? meta.lastPhase ?? null,
      lastPhaseMessage: checkpoint?.message ?? meta.lastPhaseMessage ?? null,
      lastPhaseRatio: checkpoint?.ratio ?? meta.lastPhaseRatio ?? null,
      analysisStartedAt: meta.analysisStartedAt ?? null,
      script: await readScript(dir),
      pipeline: meta.pipeline,
      hasTranscript: existsSync(path.join(projectDir(root, slug), "analysis", "words.json")),
      clips: cuts.clips,
      groups: cuts.groups,
      order: cuts.order,
      canvasDraft: cuts.canvasDraft,
      history: await listHistory(projectDir(root, slug), meta),
    };
  });

  app.put("/api/studio/projects/:slug/script", async (request) => {
    const { slug } = request.params as { slug: string };
    const body = z
      .object({
        baseRevision: z.number().int(),
        script: z.string().nullable().optional(),
        actor: actorSchema.optional(),
      })
      .parse(request.body ?? {});
    const actor = actorOf(request.headers["x-krayon-actor"] as string | undefined, body);
    return withLock(slug, async () => {
      const { dir, meta, cuts } = await load(root, slug);
      if (body.baseRevision !== meta.revision) throw new ConflictError(meta.revision, body.baseRevision);
      const next = normalizeScriptText(body.script ?? "");
      await writeScript(dir, next);
      meta.scriptLineCount = countScriptLines(next);
      meta.needsRebuild = true;
      meta.statusMessage = next.trim() ? "Script updated; rebuild to apply" : "Script cleared; rebuild to apply";
      const entry = await commitRevision(dir, meta, cuts, actor, "script", next.trim() ? "script updated" : "script cleared");
      deps.hub.publish(slug, {
        type: "revision",
        revision: entry.revision,
        actor,
        label: entry.label,
        summary: entry.summary,
      });
      return { revision: entry.revision, script: await readScript(dir), scriptLineCount: meta.scriptLineCount, needsRebuild: true };
    });
  });

  app.get("/api/studio/projects/:slug/settings", async (request) => {
    const { slug } = request.params as { slug: string };
    const { meta } = await load(root, slug);
    return { settings: meta.settings ?? DEFAULT_SETTINGS };
  });

  app.patch("/api/studio/projects/:slug/settings", async (request) => {
    const { slug } = request.params as { slug: string };
    const body = z
      .object({
        silenceThreshold: z.number().optional(),
        pad: z.number().optional(),
        similarityThreshold: z.number().optional(),
        snapToAudio: z.boolean().optional(),
        snapSearchSeconds: z.number().optional(),
        scriptMatchThreshold: z.number().optional(),
        scriptConfirmThreshold: z.number().optional(),
        scriptPreferLastTakes: z.boolean().optional(),
        scriptWhisperPrompt: z.boolean().optional(),
      })
      .parse(request.body ?? {});
    return withLock(slug, async () => {
      const { dir, meta } = await load(root, slug);
      meta.settings = normalizeSettings({ ...meta.settings, ...body });
      await saveMeta(dir, meta);
      return { settings: meta.settings };
    });
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

  app.post("/api/studio/projects/:slug/reset-status", async (request) => {
    const { slug } = request.params as { slug: string };
    return withLock(slug, async () => {
      const { dir, meta, cuts } = await load(root, slug);
      await resetProjectStatus(dir, meta, cuts);
      return { status: meta.status, statusMessage: meta.statusMessage, revision: meta.revision };
    });
  });

  app.post("/api/studio/projects/:slug/analyze", async (request) => {
    const { slug } = request.params as { slug: string };
    const body = (request.body ?? {}) as {
      baseRevision?: number;
      silenceThreshold?: number;
      pad?: number;
      similarityThreshold?: number;
      language?: string;
      pipeline?: PipelineMode;
    };
    const actor = actorOf(request.headers["x-krayon-actor"] as string | undefined, body);
    const started = await claimAnalysis(slug, body.baseRevision, "Starting analysis");
    try {
      const script = await readScript(started.dir);
      const result = await runPythonAnalysis<AnalysisPayload>(
        slug,
        "/api/audio-studio/analyze/async",
        {
          sourcePath: started.meta.sourcePath,
          analysisDir: path.join(started.dir, "analysis"),
          language: body.language ?? "en",
          pipeline: body.pipeline ?? "auto",
          script,
          ...pythonSettings(started.meta, body),
        },
      );
      return await withLock(slug, async () => {
        if (isDeleted(slug)) throw new NotFoundError(`Unknown project ${slug}`);
        const fresh = await load(root, slug);
        if (fresh.meta.revision !== started.meta.revision) {
          fresh.meta.status = "ready";
          fresh.meta.statusMessage = "Analysis discarded because the project changed";
          await saveMeta(fresh.dir, fresh.meta);
          throw new ConflictError(fresh.meta.revision, started.meta.revision);
        }
        const ids = { nextClipSeq: fresh.meta.nextClipSeq, nextGroupSeq: fresh.meta.nextGroupSeq };
        const adopted = adoptAnalysis(fresh.cuts, ids, result, { initial: fresh.cuts.clips.length === 0 });
        fresh.meta.nextClipSeq = ids.nextClipSeq;
        fresh.meta.nextGroupSeq = ids.nextGroupSeq;
        fresh.meta.status = "ready";
        fresh.meta.lastPipeline = result.pipeline === "scripted" ? "scripted" : "transcript";
        fresh.meta.needsRebuild = false;
        fresh.meta.statusMessage = `Analyzed ${adopted.doc.clips.length} clips`;
        if (fresh.meta.lastPipeline === "scripted") {
          await enqueueScriptConfirms(
            fresh.dir,
            adopted.doc,
            fresh.meta.settings.scriptConfirmThreshold,
            "algorithm",
          );
        }
        const entry = await commitRevision(fresh.dir, fresh.meta, adopted.doc, actor, "analyze", fresh.meta.statusMessage);
        deps.hub.publish(slug, {
          type: "revision",
          revision: entry.revision,
          actor,
          label: entry.label,
          summary: entry.summary,
        });
        return { revision: entry.revision, clipCount: adopted.doc.clips.length, summary: entry.summary };
      });
    } catch (error) {
      if (isDeleted(slug) || (error instanceof Error && error.message === "cancelled")) {
        return { cancelled: true };
      }
      if (!(error instanceof ConflictError) && !(error instanceof BusyError) && !(error instanceof NotFoundError)) {
        await failAnalysis(slug, error instanceof Error ? error.message : "Analysis failed");
        deps.hub.publish(slug, { type: "status", status: "error", message: error instanceof Error ? error.message : "Analysis failed" });
      }
      throw error;
    }
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
      audioStats: await audioStatsFor(projectDir(root, slug), clip),
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
    const cacheDir = path.join(dir, "analysis", "previews");
    const cachePath = path.join(cacheDir, `${id}-r${cuts.revision}-p${Number.isFinite(pad) ? pad : 0}.wav`);
    try {
      await stat(cachePath);
    } catch {
      const wav = path.join(dir, "analysis", "source.wav");
      const ranges = playRanges(clip).map((range) => `${range.sourceStart},${range.sourceEnd}`).join(";");
      const url = new URL("/api/audio-studio/clip-audio", python);
      url.searchParams.set("wav", wav);
      url.searchParams.set("ranges", ranges);
      url.searchParams.set("pad", String(Number.isFinite(pad) ? pad : 0));
      const response = await fetch(url);
      if (!response.ok) throw new Error(await response.text());
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cachePath, Buffer.from(await response.arrayBuffer()));
    }
    return sendFile(request, reply, cachePath, "audio/wav");
  });

  app.get("/api/studio/projects/:slug/clips/:id/peaks", async (request) => {
    const { slug, id } = request.params as { slug: string; id: string };
    const query = request.query as { buckets?: string; pad?: string };
    const buckets = Math.max(1, Math.min(4096, Number(query.buckets ?? 800) || 800));
    const { dir, meta, cuts } = await load(root, slug);
    const clip = cuts.clips.find((item) => item.id === id);
    if (!clip) throw new OpError([{ clipId: id, field: "id", message: `Unknown clip ${id}` }]);
    const pad = Number(query.pad ?? meta.settings?.pad ?? DEFAULT_SETTINGS.pad);
    const cacheDir = path.join(dir, "analysis", "peaks");
    const cachePath = path.join(cacheDir, `${id}-r${cuts.revision}-p${pad}-b${buckets}.json`);
    try {
      return JSON.parse(await readFile(cachePath, "utf8")) as { duration: number; peaks: number[] };
    } catch {
      /* miss */
    }
    const wav = path.join(dir, "analysis", "source.wav");
    try {
      await stat(wav);
    } catch {
      throw new OpError([{ clipId: id, field: "audio", message: "No analysis WAV; run Analyze first" }]);
    }
    const ranges = playRanges(clip).map((range) => `${range.sourceStart},${range.sourceEnd}`).join(";");
    const url = new URL("/api/audio-studio/clip-peaks", python);
    url.searchParams.set("wav", wav);
    url.searchParams.set("ranges", ranges);
    url.searchParams.set("pad", String(Number.isFinite(pad) ? pad : 0));
    url.searchParams.set("buckets", String(buckets));
    const response = await fetch(url);
    if (!response.ok) throw new Error(await response.text());
    const payload = (await response.json()) as { duration: number; peaks: number[] };
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, JSON.stringify(payload));
    return payload;
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
        reset: z.boolean().optional(),
        pipeline: z.enum(["auto", "transcript", "scripted"]).optional(),
      })
      .parse(request.body);
    const actor = actorOf(request.headers["x-krayon-actor"] as string | undefined, body);
    const started = await claimAnalysis(slug, body.baseRevision, body.mode);
    const chosen = body.clipIds
      ?.map((id) => started.cuts.clips.find((clip) => clip.id === id))
      .filter((clip): clip is Clip => clip != null) ?? [];
    if (body.clipIds && chosen.length !== body.clipIds.length) {
      await failAnalysis(slug, "Unknown clip id");
      throw new OpError([{ clipId: body.clipIds[0] ?? null, field: "clipIds", message: "Unknown clip id", allowed: started.cuts.clips.map((clip) => clip.id) }]);
    }
    const rangeStart = body.rangeStart ?? (chosen.length ? Math.min(...chosen.map((clip) => clip.sourceStart)) : undefined);
    const rangeEnd = body.rangeEnd ?? (chosen.length ? Math.max(...chosen.map((clip) => clip.sourceEnd)) : undefined);
    const runPipeline = resolvedPipeline(started.meta, body.pipeline);
    const fullResegment = body.mode === "resegment" && rangeStart == null && rangeEnd == null && (!body.clipIds || body.clipIds.length === 0);
    try {
      const script = await readScript(started.dir);
      const result = await runPythonAnalysis<AnalysisPayload>(
        slug,
        fullResegment
          ? "/api/audio-studio/analyze/async"
          : "/api/audio-studio/reanalyze/async",
        fullResegment
          ? {
              sourcePath: started.meta.sourcePath,
              analysisDir: path.join(started.dir, "analysis"),
              pipeline: runPipeline,
              script: runPipeline === "scripted" ? script : "",
              language: "en",
              ...pythonSettings(started.meta, body),
            }
          : {
          sourcePath: started.meta.sourcePath,
          analysisDir: path.join(started.dir, "analysis"),
          mode: body.mode,
          rangeStart,
          rangeEnd,
          silenceThreshold: body.silenceThreshold ?? started.meta.settings?.silenceThreshold ?? DEFAULT_SETTINGS.silenceThreshold,
          pad: body.pad ?? started.meta.settings?.pad ?? DEFAULT_SETTINGS.pad,
          similarityThreshold: body.similarityThreshold ?? started.meta.settings?.similarityThreshold ?? DEFAULT_SETTINGS.similarityThreshold,
          snapToAudio: started.meta.settings?.snapToAudio ?? DEFAULT_SETTINGS.snapToAudio,
          snapSearchSeconds: started.meta.settings?.snapSearchSeconds ?? DEFAULT_SETTINGS.snapSearchSeconds,
          clips: started.cuts.clips.map(toPythonClip),
        },
      );
      return await withLock(slug, async () => {
        if (isDeleted(slug)) throw new NotFoundError(`Unknown project ${slug}`);
        const fresh = await load(root, slug);
        if (fresh.meta.revision !== started.meta.revision) {
          fresh.meta.status = "ready";
          fresh.meta.statusMessage = "Reanalysis discarded because the project changed";
          await saveMeta(fresh.dir, fresh.meta);
          throw new ConflictError(fresh.meta.revision, started.meta.revision);
        }
        const ids = { nextClipSeq: fresh.meta.nextClipSeq, nextGroupSeq: fresh.meta.nextGroupSeq };
        const scriptedRun = fullResegment && runPipeline === "scripted";
        const adopted = adoptAnalysis(fresh.cuts, ids, { ...result, rangeStart: result.rangeStart ?? rangeStart, rangeEnd: result.rangeEnd ?? rangeEnd }, {
          regroup: body.mode === "regroup" && !body.reset,
          initial: Boolean(body.reset) && !scriptedRun,
          reset: Boolean(body.reset) && !scriptedRun,
        });
        fresh.meta.nextClipSeq = ids.nextClipSeq;
        fresh.meta.nextGroupSeq = ids.nextGroupSeq;
        fresh.meta.status = "ready";
        fresh.meta.lastPipeline = scriptedRun ? "scripted" : "transcript";
        fresh.meta.needsRebuild = false;
        if (scriptedRun) {
          await enqueueScriptConfirms(fresh.dir, adopted.doc, fresh.meta.settings.scriptConfirmThreshold, "algorithm");
        }
        fresh.meta.statusMessage = adopted.retired.length ? `Retired ${adopted.retired.join(", ")}` : "Reanalysis kept clip ids";
        const entry = await commitRevision(fresh.dir, fresh.meta, adopted.doc, actor, body.label ?? body.mode, fresh.meta.statusMessage);
        deps.hub.publish(slug, { type: "revision", revision: entry.revision, actor, label: entry.label, summary: entry.summary });
        return { revision: entry.revision, summary: entry.summary, created: adopted.created, retired: adopted.retired };
      });
    } catch (error) {
      if (isDeleted(slug) || (error instanceof Error && error.message === "cancelled")) {
        return { cancelled: true };
      }
      if (!(error instanceof ConflictError) && !(error instanceof BusyError) && !(error instanceof OpError) && !(error instanceof NotFoundError)) {
        await failAnalysis(slug, error instanceof Error ? error.message : "Reanalysis failed");
      }
      throw error;
    }
  });

  app.get("/api/studio/projects/:slug/lint", async (request) => {
    const { slug } = request.params as { slug: string };
    const { dir, cuts } = await load(root, slug);
    const stats: Record<string, AudioEdgeStats> = {};
    await Promise.all(
      cuts.clips.map(async (clip) => {
        const edge = await audioStatsFor(dir, clip);
        if (edge) stats[clip.id] = edge;
      }),
    );
    return { revision: cuts.revision, warnings: lintCuts(cuts, stats) };
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

  app.post("/api/studio/projects/:slug/confirmations", async (request) => {
    const { slug } = request.params as { slug: string };
    const createdBy = actorOf(request.headers["x-krayon-actor"] as string | undefined, request.body);
    return withLock(slug, async () => {
      const { dir, meta, cuts } = await load(root, slug);
      const input = validateConfirmationInput(request.body ?? {}, cuts, {
        nextClipSeq: meta.nextClipSeq,
        nextGroupSeq: meta.nextGroupSeq,
      });
      const file = await readConfirmations(dir);
      const item = mintConfirmation(file, input, createdBy);
      await writeConfirmations(dir, file);
      armExpiry(slug, item);
      publishConfirmation(slug, "confirmation_created", item);
      return item;
    });
  });

  app.get("/api/studio/projects/:slug/confirmations/wait-any", async (request) => {
    const { slug } = request.params as { slug: string };
    const query = request.query as { timeoutMs?: string; since?: string };
    const timeoutMs = Number(query.timeoutMs ?? 600000);
    const since = Number(query.since ?? 0);
    const { dir } = await load(root, slug);
    const file = await readConfirmations(dir);
    const already = file.items.find((item) => item.seq > since && item.status !== "pending");
    if (already) return already;
    return waitForConfirmation({
      since,
      timeoutMs,
      onAbort: (listener) => request.raw.on("close", listener),
    });
  });

  app.get("/api/studio/projects/:slug/confirmations", async (request) => {
    const { slug } = request.params as { slug: string };
    const status = (request.query as { status?: string }).status ?? "pending";
    const { dir } = await load(root, slug);
    const file = await readConfirmations(dir);
    const items =
      status === "all"
        ? file.items
        : status === "answered"
          ? file.items.filter((item) => item.status !== "pending")
          : file.items.filter((item) => item.status === "pending");
    return { items, nextSeq: file.nextSeq };
  });

  app.get("/api/studio/projects/:slug/confirmations/:id/wait", async (request) => {
    const { slug, id } = request.params as { slug: string; id: string };
    const timeoutMs = Number((request.query as { timeoutMs?: string }).timeoutMs ?? 600000);
    const { dir } = await load(root, slug);
    const file = await readConfirmations(dir);
    const item = file.items.find((entry) => entry.id === id);
    if (!item) throw new NotFoundError(`Unknown confirmation ${id}`);
    if (item.status !== "pending") return item;
    return waitForConfirmation({
      id,
      timeoutMs,
      onAbort: (listener) => request.raw.on("close", listener),
    });
  });

  app.get("/api/studio/projects/:slug/confirmations/:id", async (request) => {
    const { slug, id } = request.params as { slug: string; id: string };
    const { dir } = await load(root, slug);
    const file = await readConfirmations(dir);
    const item = file.items.find((entry) => entry.id === id);
    if (!item) throw new NotFoundError(`Unknown confirmation ${id}`);
    return item;
  });

  app.post("/api/studio/projects/:slug/confirmations/:id/answer", async (request) => {
    const { slug, id } = request.params as { slug: string; id: string };
    const body = z.object({ optionId: z.string(), note: z.string().optional(), actor: actorSchema.optional() }).parse(request.body ?? {});
    const actor = actorOf(request.headers["x-krayon-actor"] as string | undefined, { actor: body.actor ?? "human" });
    return withLock(slug, async () => {
      const { dir, meta, cuts } = await load(root, slug);
      const file = await readConfirmations(dir);
      const item = file.items.find((entry) => entry.id === id);
      if (!item) throw new NotFoundError(`Unknown confirmation ${id}`);
      if (item.status !== "pending") throw new BusyError("Confirmation is not pending");
      const option = item.options.find((entry) => entry.id === body.optionId);
      if (!option) throw new OpError([{ clipId: null, field: "optionId", message: "Unknown option", allowed: item.options.map((entry) => entry.id) }]);
      item.answer = { optionId: option.id, note: body.note ?? "", by: actor, at: new Date().toISOString() };
      clearExpiry(slug, item.id);
      if (option.applyOps && item.proposedOps) {
        if (meta.revision !== item.proposedOps.baseRevision) {
          item.status = "stale";
          item.result = { applied: false, revision: meta.revision, error: "stale_revision" };
        } else {
          const ids = { nextClipSeq: meta.nextClipSeq, nextGroupSeq: meta.nextGroupSeq };
          const applied = applyOps(cuts, ids, item.proposedOps.ops, "human");
          meta.nextClipSeq = ids.nextClipSeq;
          meta.nextGroupSeq = ids.nextGroupSeq;
          const entry = await commitRevision(dir, meta, applied.doc, "human", "confirmation", applied.summary);
          item.status = "answered";
          item.result = { applied: true, revision: entry.revision, error: null };
          deps.hub.publish(slug, { type: "revision", revision: entry.revision, actor: "human", label: "confirmation", summary: applied.summary });
        }
      } else {
        item.status = "answered";
        item.result = { applied: false, revision: meta.revision, error: null };
      }
      await writeConfirmations(dir, file);
      publishConfirmation(slug, "confirmation_resolved", item);
      return item;
    });
  });

  app.post("/api/studio/projects/:slug/confirmations/:id/cancel", async (request) => {
    const { slug, id } = request.params as { slug: string; id: string };
    return withLock(slug, async () => {
      const { dir } = await load(root, slug);
      const file = await readConfirmations(dir);
      const item = file.items.find((entry) => entry.id === id);
      if (!item) throw new NotFoundError(`Unknown confirmation ${id}`);
      if (item.status !== "pending") throw new BusyError("Confirmation is not pending");
      item.status = "cancelled";
      item.result = { applied: false, revision: null, error: "cancelled" };
      clearExpiry(slug, item.id);
      await writeConfirmations(dir, file);
      publishConfirmation(slug, "confirmation_cancelled", item);
      return item;
    });
  });

  app.post("/api/studio/projects/:slug/render", async (request) => {
    const { slug } = request.params as { slug: string };
    const body = z.object({ quality: z.enum(["preview", "final"]).default("final") }).parse(request.body ?? {});
    const { dir, meta, cuts } = await load(root, slug);
    throwIfBusy(meta.status);
    if (!meta.sourcePath) throw new OpError([{ clipId: null, field: "source", message: "Import a video first" }]);
    const selected = cuts.order
      .map((id) => cuts.clips.find((clip) => clip.id === id))
      .filter((clip): clip is Clip => clip != null && clip.status === "selected");
    if (selected.length === 0) {
      throw new OpError([{ clipId: null, field: "order", message: "Select at least one clip before rendering" }]);
    }
    const renderId = `${body.quality}-${cuts.revision}-${Date.now()}`;
    const outputName = `${renderId}.mp4`;
    const outputPath = path.join(dir, "output", outputName);
    renders.set(renderId, { id: renderId, slug, status: "rendering", ratio: 0, message: "Starting render" });
    meta.status = "rendering";
    await saveMeta(dir, meta);
    const started = await pythonJson<{ jobId: string }>(python, "/api/audio-studio/render/async", {
      sourcePath: meta.sourcePath,
      outputPath,
      quality: body.quality,
      clips: selected.map((clip) => ({ id: clip.id, ranges: playRanges(clip) })),
    });
    const job = renders.get(renderId);
    if (job) job.pythonJobId = started.jobId;
    void waitForPythonJob(python, started.jobId, {
      onProgress: (event) => {
        const current = renders.get(renderId);
        if (current) {
          current.ratio = event.progress ?? current.ratio;
          current.message = event.message ?? current.message;
        }
        deps.hub.publish(slug, {
          type: "render",
          renderId,
          phase: "rendering",
          ratio: event.progress,
          message: event.message,
        });
      },
    })
      .then(async () => {
        if (isDeleted(slug) || renders.get(renderId)?.status === "cancelled") return;
        const current = renders.get(renderId);
        if (current) {
          current.status = "done";
          current.ratio = 1;
          current.outputName = outputName;
          current.message = "Render complete";
        }
        const latest = await readMeta(dir);
        latest.status = "ready";
        latest.statusMessage = `Rendered ${outputName}`;
        await saveMeta(dir, latest);
        deps.hub.publish(slug, { type: "render", renderId, phase: "done", ratio: 1, message: "Render complete", outputName });
      })
      .catch(async (error: unknown) => {
        if (isDeleted(slug)) return;
        const message = error instanceof Error ? error.message : "Render failed";
        const current = renders.get(renderId);
        if (message === "cancelled" || current?.status === "cancelled") return;
        if (current) {
          current.status = "error";
          current.message = message;
        }
        try {
          const latest = await readMeta(dir);
          if (latest.status === "rendering") {
            latest.status = "ready";
            latest.statusMessage = message;
            await saveMeta(dir, latest);
          }
        } catch {
          return;
        }
        deps.hub.publish(slug, { type: "render", renderId, phase: "error", message });
      });
    return { renderId, outputName };
  });

  app.post("/api/studio/projects/:slug/render/:id/cancel", async (request) => {
    const { slug, id } = request.params as { slug: string; id: string };
    const job = renders.get(id);
    if (!job) throw new NotFoundError(`Unknown render ${id}`);
    if (job.pythonJobId) await cancelPythonJob(python, job.pythonJobId);
    job.status = "cancelled";
    job.message = "cancelled";
    const outputName = job.outputName ?? `${id}.mp4`;
    await unlink(path.join(projectDir(root, slug), "output", outputName)).catch(() => undefined);
    await withLock(slug, async () => {
      const { dir, meta } = await load(root, slug);
      if (meta.status === "rendering") {
        meta.status = "ready";
        meta.statusMessage = "Render cancelled";
        await saveMeta(dir, meta);
      }
    });
    deps.hub.publish(slug, { type: "render", renderId: id, phase: "cancelled", message: "cancelled", ratio: job.ratio });
    return { id, status: "cancelled" };
  });

  app.get("/api/studio/projects/:slug/render/:id", async (request) => {
    const { slug, id } = request.params as { slug: string; id: string };
    const job = renders.get(id);
    if (job) return job;
    const outputName = `${id}.mp4`;
    const filePath = path.join(projectDir(root, slug), "output", outputName);
    try {
      await stat(filePath);
      return { id, status: "done", ratio: 1, outputName, message: "Render complete" };
    } catch {
      throw new NotFoundError(`Unknown render ${id}`);
    }
  });

  app.get("/api/studio/projects/:slug/output", async (request) => {
    const { slug } = request.params as { slug: string };
    const dir = projectDir(root, slug);
    const names = await readdir(path.join(dir, "output")).catch(() => [] as string[]);
    const manifests = [];
    for (const name of names.filter((item) => item.endsWith(".json"))) {
      const filePath = path.join(dir, "output", name);
      const info = await stat(filePath).catch(() => null);
      const mp4Name = name.replace(/\.json$/, ".mp4");
      const mp4Info = await stat(path.join(dir, "output", mp4Name)).catch(() => null);
      const payload = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
      manifests.push({
        ...payload,
        name: mp4Name,
        size: mp4Info?.size ?? 0,
        createdAt: (mp4Info ?? info)?.mtime.toISOString() ?? null,
      });
    }
    manifests.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    return { files: names, manifests };
  });

  app.get("/api/studio/projects/:slug/segments", async (request) => {
    const { slug } = request.params as { slug: string };
    const { dir, meta, cuts } = await load(root, slug);
    const settings = meta.settings ?? DEFAULT_SETTINGS;
    const payload = await pythonJson<{ sourceDuration: number; segments: Array<{ kind: string; sourceStart: number; sourceEnd: number; duration: number; text: string }> }>(
      python,
      "/api/audio-studio/segments",
      {
        analysisDir: path.join(dir, "analysis"),
        silenceThreshold: settings.silenceThreshold,
        pad: settings.pad,
        sourceDuration: cuts.clips.reduce((max, clip) => Math.max(max, clip.sourceEnd), 0),
      },
    ).catch(() => ({ sourceDuration: 0, segments: [] as Array<{ kind: string; sourceStart: number; sourceEnd: number; duration: number; text: string }> }));
    const speech = payload.segments;
    const duration = payload.sourceDuration;
    const rows: Array<{
      kind: "speech" | "silence";
      sourceStart: number;
      sourceEnd: number;
      duration: number;
      text: string;
      clipId: string | null;
      status: string | null;
    }> = [];
    const pushSilence = (start: number, end: number) => {
      if (end - start < 0.05) return;
      rows.push({
        kind: "silence",
        sourceStart: start,
        sourceEnd: end,
        duration: end - start,
        text: "",
        clipId: null,
        status: null,
      });
    };
    let cursor = 0;
    for (const segment of speech) {
      pushSilence(cursor, segment.sourceStart);
      const clip = cuts.clips
        .map((item) => {
          const overlap = Math.max(0, Math.min(item.sourceEnd, segment.sourceEnd) - Math.max(item.sourceStart, segment.sourceStart));
          return { item, overlap };
        })
        .sort((a, b) => b.overlap - a.overlap)[0];
      const matched = clip && clip.overlap > 0.05 ? clip.item : null;
      rows.push({
        kind: "speech",
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceEnd,
        duration: segment.duration,
        text: segment.text,
        clipId: matched?.id ?? null,
        status: matched?.status ?? null,
      });
      cursor = segment.sourceEnd;
    }
    pushSilence(cursor, duration);
    return { sourceDuration: duration, segments: rows };
  });

  app.get("/api/studio/projects/:slug/transcript", async (request) => {
    const { slug } = request.params as { slug: string };
    const { dir, cuts } = await load(root, slug);
    const wordsPath = path.join(dir, "analysis", "words.json");
    const raw = JSON.parse(await readFile(wordsPath, "utf8").catch(() => "{\"words\":[]}")) as
      | { words?: Array<{ text: string; start: number; end: number }> }
      | Array<{ text: string; start: number; end: number }>;
    const words = Array.isArray(raw) ? raw : (raw.words ?? []);
    const items = words.map((word) => {
      const hit = cuts.clips
        .map((clip) => {
          const overlap = Math.max(0, Math.min(clip.sourceEnd, word.end) - Math.max(clip.sourceStart, word.start));
          return { clip, overlap };
        })
        .sort((a, b) => b.overlap - a.overlap)[0];
      return {
        text: word.text,
        start: word.start,
        end: word.end,
        clipId: hit && hit.overlap > 0 ? hit.clip.id : null,
      };
    });
    return { words: items };
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

export function parseByteRange(
  header: string | undefined,
  size: number,
): { kind: "all" } | { kind: "range"; start: number; end: number } | { kind: "unsatisfiable" } {
  if (!header) return { kind: "all" };
  const suffix = /^bytes=-(\d+)$/.exec(header.trim());
  if (suffix) {
    const length = Number(suffix[1]);
    if (!Number.isFinite(length) || length <= 0 || size <= 0) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, size - length), end: size - 1 };
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: "unsatisfiable" };
  const start = Number(match[1]);
  if (!Number.isFinite(start) || start < 0 || start >= size) return { kind: "unsatisfiable" };
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isFinite(end) || end < start) return { kind: "unsatisfiable" };
  return { kind: "range", start, end };
}

async function sendFile(request: FastifyRequest, reply: FastifyReply, filePath: string, contentType?: string) {
  const info = await stat(filePath);
  const type =
    contentType ??
    (filePath.endsWith(".mp4") ? "video/mp4" : filePath.endsWith(".wav") ? "audio/wav" : "application/octet-stream");
  reply.header("Accept-Ranges", "bytes");
  reply.header("Content-Type", type);
  const rangeHeader = request.headers.range;
  const parsed = parseByteRange(Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader, info.size);
  if (parsed.kind === "unsatisfiable") {
    reply.code(416);
    reply.header("Content-Range", `bytes */${info.size}`);
    return reply.send();
  }
  if (parsed.kind === "all") {
    reply.header("Content-Length", String(info.size));
    return reply.send(createReadStream(filePath));
  }
  reply.code(206);
  reply.header("Content-Range", `bytes ${parsed.start}-${parsed.end}/${info.size}`);
  reply.header("Content-Length", String(parsed.end - parsed.start + 1));
  return reply.send(createReadStream(filePath, { start: parsed.start, end: parsed.end }));
}

export function errorBody(error: unknown): { status: number; body: unknown } | null {
  if (error instanceof NotFoundError) {
    return { status: 404, body: { error: "not_found", message: error.message } };
  }
  if (error instanceof OpError) {
    return { status: 400, body: { error: "validation", message: error.message, errors: error.errors } };
  }
  if (error instanceof NameConflictError) {
    return { status: 409, body: { error: "conflict", message: error.message } };
  }
  if (error instanceof InvalidSlugError) {
    return { status: 400, body: { error: "validation", message: error.message } };
  }
  if (error instanceof ConflictError || error instanceof BusyError) {
    return {
      status: 409,
      body: {
        error: "conflict",
        message: error.message,
        ...("currentRevision" in error ? { currentRevision: error.currentRevision } : {}),
      },
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
