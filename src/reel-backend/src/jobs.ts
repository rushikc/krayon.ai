import type { JobModels } from "./apiTypes.js";
import type { CanvasElement } from "./canvas/types.js";
import type { ReelConfig } from "./config.js";
import { AppError } from "./errors.js";
import { EventHub } from "./events.js";
import type { GeminiClient } from "./gemini.js";
import type { Logger } from "./logging.js";
import { runPipeline } from "./pipeline.js";
import type { ReelStore } from "./store.js";

export class JobRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly keys = new Map<string, string>();

  constructor(
    private readonly store: ReelStore,
    private readonly hub: EventHub,
    private readonly client: GeminiClient,
    private readonly config: ReelConfig,
    private readonly log: Logger,
  ) {}

  start(jobId: string, apiKey: string) {
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    this.keys.set(jobId, apiKey);
    void this.run(jobId, apiKey, controller.signal).finally(() => {
      this.keys.delete(jobId);
      this.controllers.delete(jobId);
    });
  }

  cancel(jobId: string) {
    const job = this.store.getJob(jobId);
    if (!job) throw new AppError("NOT_FOUND", "Job not found");
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
      throw new AppError("CONFLICT", `Job already ${job.status}`);
    }
    const controller = this.controllers.get(jobId);
    controller?.abort();
    this.keys.delete(jobId);
    this.store.updateJob(jobId, {
      status: "cancelled",
      progress: { ...job.progress, phase: "cancelled", message: "Cancelled" },
      error: { code: "CANCELLED", message: "Job cancelled" },
    });
    this.hub.emit(jobId, { type: "cancelled" });
  }

  private async run(jobId: string, apiKey: string, signal: AbortSignal) {
    const job = this.store.getJob(jobId);
    if (!job) return;
    this.store.updateJob(jobId, {
      status: "running",
      progress: { phase: "running", message: "Starting", round: 0, ratio: 0.01 },
    });
    let startingScene: CanvasElement[] | undefined;
    if (job.parentJobId) {
      const parent = this.store.getJob(job.parentJobId);
      startingScene = parent?.result?.scene ?? parent?.rounds.at(-1)?.scene;
      if (!startingScene) {
        const err = new AppError("CONFLICT", "Parent job has no scene to refine");
        this.fail(jobId, err);
        return;
      }
    }
    try {
      await runPipeline({
        jobId,
        script: job.script,
        apiKey,
        models: job.models,
        maxRounds: job.maxRounds,
        passScore: job.passScore,
        startingScene,
        refineInstructions: job.refineInstructions,
        config: this.config,
        store: this.store,
        client: this.client,
        log: this.log,
        signal,
        hooks: {
          onProgress: (progress) => {
            this.store.updateJob(jobId, { progress, status: "running" });
            this.hub.emit(jobId, {
              type: "progress",
              phase: progress.phase,
              message: progress.message,
              round: progress.round,
              ratio: progress.ratio,
            });
          },
          onRoundPhase: (round, phase) => {
            this.hub.emit(jobId, { type: "round", round, phase });
          },
        },
      });
      if (signal.aborted) return;
      const done = this.store.getJob(jobId);
      if (done) this.hub.emit(jobId, { type: "done", job: done });
    } catch (error) {
      if (signal.aborted) return;
      this.fail(jobId, error);
    }
  }

  private fail(jobId: string, error: unknown) {
    const code = error instanceof AppError ? error.code : "UPSTREAM";
    const message = error instanceof Error ? error.message : String(error);
    this.log.error("Job failed", { jobId, code }, error);
    this.store.updateJob(jobId, {
      status: "error",
      progress: { phase: "error", message, round: 0, ratio: 1 },
      error: { code, message },
    });
    this.hub.emit(jobId, { type: "error", code, message });
  }
}

export function createJobId(): string {
  return crypto.randomUUID();
}

export type CreateJobBody = {
  script: string;
  maxRounds?: number;
  models?: Partial<JobModels>;
};
