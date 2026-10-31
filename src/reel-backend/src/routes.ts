import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { ReelConfig } from "./config.js";
import { AppError, httpErrorBody } from "./errors.js";
import type { EventHub } from "./events.js";
import type { JobRunner } from "./jobs.js";
import { createJobId } from "./jobs.js";
import type { ReelStore } from "./store.js";

const GEMINI_HEADER = "x-gemini-api-key";

function readKey(headers: Record<string, unknown>): string {
  const raw = headers[GEMINI_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError("UNAUTHORIZED", "Missing X-Gemini-Api-Key header");
  }
  return value.trim();
}

function sendError(reply: { code: (n: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  const { status, body } = httpErrorBody(error);
  return reply.code(status).send(body);
}

export function registerRoutes(
  app: FastifyInstance,
  deps: { store: ReelStore; runner: JobRunner; hub: EventHub; config: ReelConfig },
) {
  const { store, runner, hub, config } = deps;

  app.get("/api/reel/health", async () => ({ ok: true, service: "reel-backend" }));

  app.post("/api/reel/jobs", async (req, reply) => {
    try {
      const apiKey = readKey(req.headers as Record<string, unknown>);
      const body = (req.body ?? {}) as { script?: unknown; maxRounds?: unknown; models?: unknown };
      if (typeof body.script !== "string" || body.script.trim() === "") {
        throw new AppError("BAD_REQUEST", "script is required");
      }
      const maxRounds =
        typeof body.maxRounds === "number" && Number.isInteger(body.maxRounds) && body.maxRounds > 0
          ? body.maxRounds
          : config.pipeline.maxRounds;
      const modelsIn = body.models && typeof body.models === "object" ? (body.models as Record<string, unknown>) : {};
      const models = {
        generate: typeof modelsIn.generate === "string" ? modelsIn.generate : config.gemini.model,
        review: typeof modelsIn.review === "string" ? modelsIn.review : config.gemini.reviewModel,
        fix: typeof modelsIn.fix === "string" ? modelsIn.fix : config.gemini.fixModel,
      };
      const id = createJobId();
      store.createJob({
        id,
        script: body.script,
        models,
        maxRounds,
        passScore: config.pipeline.passScore,
      });
      runner.start(id, apiKey);
      return reply.code(202).send({ jobId: id });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/reel/jobs", async () => ({ jobs: store.listJobs() }));

  app.get("/api/reel/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = store.getJob(id);
    if (!job) return sendError(reply, new AppError("NOT_FOUND", "Job not found"));
    return job;
  });

  app.get("/api/reel/jobs/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = store.getJob(id);
    if (!job) return sendError(reply, new AppError("NOT_FOUND", "Job not found"));
    const lastRaw = req.headers["last-event-id"];
    const lastId = Number(typeof lastRaw === "string" ? lastRaw : 0);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    let unsub = () => {};
    const ping = setInterval(() => {
      reply.raw.write(`: ping\n\n`);
    }, 15_000);
    const closeStream = () => {
      clearInterval(ping);
      unsub();
      if (!reply.raw.writableEnded) reply.raw.end();
    };
    const write = (seq: number, event: { type?: string; [key: string]: unknown }) => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`id: ${seq}\nevent: message\ndata: ${JSON.stringify(event)}\n\n`);
      if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
        closeStream();
      }
    };
    write(0, { type: "snapshot", job: store.getJob(id) });
    unsub = hub.subscribe(id, Number.isFinite(lastId) ? lastId : 0, write);
    req.raw.on("close", closeStream);
  });

  app.get("/api/reel/jobs/:id/rounds/:n/images/:index", async (req, reply) => {
    const { id, n, index } = req.params as { id: string; n: string; index: string };
    const file = store.imagePath(id, Number(n), Number(index));
    if (!file) return sendError(reply, new AppError("NOT_FOUND", "Image not found"));
    try {
      const buf = readFileSync(file);
      return reply.type("image/png").send(buf);
    } catch {
      return sendError(reply, new AppError("NOT_FOUND", "Image not found"));
    }
  });

  app.post("/api/reel/jobs/:id/cancel", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      runner.cancel(id);
      return { ok: true };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/reel/jobs/:id/refine", async (req, reply) => {
    try {
      const apiKey = readKey(req.headers as Record<string, unknown>);
      const { id } = req.params as { id: string };
      const parent = store.getJob(id);
      if (!parent) throw new AppError("NOT_FOUND", "Job not found");
      if (parent.status !== "done" || !parent.result?.scene) {
        throw new AppError("CONFLICT", "Can only refine a completed job with a scene");
      }
      const body = (req.body ?? {}) as { instructions?: unknown; maxRounds?: unknown; models?: unknown };
      if (typeof body.instructions !== "string" || body.instructions.trim() === "") {
        throw new AppError("BAD_REQUEST", "instructions is required");
      }
      const maxRounds =
        typeof body.maxRounds === "number" && Number.isInteger(body.maxRounds) && body.maxRounds > 0
          ? body.maxRounds
          : config.pipeline.maxRounds;
      const modelsIn = body.models && typeof body.models === "object" ? (body.models as Record<string, unknown>) : {};
      const models = {
        generate: typeof modelsIn.generate === "string" ? modelsIn.generate : parent.models.generate,
        review: typeof modelsIn.review === "string" ? modelsIn.review : parent.models.review,
        fix: typeof modelsIn.fix === "string" ? modelsIn.fix : parent.models.fix,
      };
      const nextId = createJobId();
      store.createJob({
        id: nextId,
        script: parent.script,
        parentJobId: parent.id,
        refineInstructions: body.instructions,
        models,
        maxRounds,
        passScore: config.pipeline.passScore,
      });
      runner.start(nextId, apiKey);
      return reply.code(202).send({ jobId: nextId, parentJobId: parent.id });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
