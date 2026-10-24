import { z } from "zod";
import type { JobModels, JobProgress } from "./apiTypes.js";
import type { CanvasElement } from "./canvas/types.js";
import type { ReelConfig } from "./config.js";
import { AppError } from "./errors.js";
import type { GeminiClient } from "./gemini.js";
import type { Logger } from "./logging.js";
import { fixScenePrompt, generateScenePrompt, repairScenePrompt, reviewScenePrompt } from "./prompts.js";
import { renderKeyframes } from "./render/png.js";
import {
  formatZodIssues,
  overallScore,
  parseReview,
  parseSceneEnvelope,
  reviewSchema,
  safeParseScene,
  type ReviewIssue,
  type ReviewResult,
  type ReviewScores,
} from "./schema/scene.js";
import { reviewResponseSchema, sceneResponseSchema } from "./schema/geminiJson.js";
import type { ReelStore } from "./store.js";

export type PipelineHooks = {
  onProgress: (progress: JobProgress) => void;
  onRoundPhase: (round: number, phase: "generate" | "render" | "review" | "fix") => void;
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new AppError("CANCELLED", "Job cancelled");
  }
}

function scoresFrom(review: ReviewResult): ReviewScores {
  return {
    clarity: review.clarity,
    readability: review.readability,
    accuracy: review.accuracy,
    overall: overallScore(review),
  };
}

function issuesText(issues: ReviewIssue[]): string {
  if (issues.length === 0) return "(no issues listed)";
  return issues
    .map((issue) => {
      const frame = issue.frameIndex != null ? ` [frame ${issue.frameIndex}]` : "";
      return `- (${issue.severity})${frame} ${issue.problem}`;
    })
    .join("\n");
}

function betterRound(
  a: { scores: ReviewScores | null; issues: ReviewIssue[]; n: number } | null,
  b: { scores: ReviewScores | null; issues: ReviewIssue[]; n: number },
) {
  if (!a) return b;
  const aScore = a.scores?.overall ?? -1;
  const bScore = b.scores?.overall ?? -1;
  if (bScore !== aScore) return bScore > aScore ? b : a;
  if (b.issues.length !== a.issues.length) return b.issues.length < a.issues.length ? b : a;
  return b.n > a.n ? b : a;
}

async function generateValidatedScene(
  client: GeminiClient,
  log: Logger,
  config: ReelConfig,
  req: {
    apiKey: string;
    model: string;
    script: string;
    timeoutMs: number;
    signal?: AbortSignal;
    initialPrompt: string;
    callType: "generate" | "fix" | "repair";
  },
): Promise<CanvasElement[]> {
  let lastError = "invalid scene";
  let lastJson = "";
  const attempts = config.pipeline.generateAttempts;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    throwIfAborted(req.signal);
    const prompt =
      attempt === 1
        ? req.initialPrompt
        : repairScenePrompt(req.script, lastJson || "(none)", lastError);
    const callType = attempt === 1 ? req.callType : "repair";
    const raw = await client.generateJson({
      apiKey: req.apiKey,
      model: req.model,
      prompt,
      schema: sceneResponseSchema,
      callType,
      timeoutMs: req.timeoutMs,
      signal: req.signal,
    });
    lastJson = JSON.stringify(raw);
    const parsed = safeParseScene(raw);
    if (parsed.ok) return parsed.elements;
    lastError = parsed.error;
    log.warn("Scene JSON failed validation", { attempt, error: lastError });
  }
  throw new AppError("SCHEMA_INVALID", lastError);
}

async function reviewOnce(
  client: GeminiClient,
  req: {
    apiKey: string;
    model: string;
    script: string;
    times: number[];
    pngs: Buffer[];
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<ReviewResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    throwIfAborted(req.signal);
    const extra = attempt === 2 ? `\nPrevious reply was invalid JSON for the review schema. Return only the schema fields.\n` : "";
    try {
      const raw = await client.generateJson({
        apiKey: req.apiKey,
        model: req.model,
        prompt: reviewScenePrompt(req.script, req.times) + extra,
        schema: reviewResponseSchema,
        files: req.pngs.map((png) => ({ data: png, mimeType: "image/png" })),
        callType: "review",
        timeoutMs: req.timeoutMs,
        signal: req.signal,
      });
      return parseReview(raw);
    } catch (error) {
      if (error instanceof AppError && error.code !== "NOT_JSON" && error.code !== "SCHEMA_INVALID") {
        throw error;
      }
      if (error instanceof z.ZodError) {
        lastError = new AppError("SCHEMA_INVALID", formatZodIssues(error));
      } else {
        lastError = error;
      }
    }
  }
  throw lastError instanceof AppError
    ? lastError
    : lastError instanceof z.ZodError
      ? new AppError("SCHEMA_INVALID", formatZodIssues(lastError))
      : new AppError("SCHEMA_INVALID", "Review JSON invalid");
}

export async function runPipeline(options: {
  jobId: string;
  script: string;
  apiKey: string;
  models: JobModels;
  maxRounds: number;
  passScore: number;
  startingScene?: CanvasElement[];
  refineInstructions?: string;
  config: ReelConfig;
  store: ReelStore;
  client: GeminiClient;
  log: Logger;
  signal?: AbortSignal;
  hooks: PipelineHooks;
}): Promise<void> {
  const { config, store, client, log, hooks, jobId, script, apiKey, models, maxRounds, passScore } = options;
  const timeoutMs = config.gemini.timeoutMs;

  const emit = (phase: string, message: string, round: number, ratio: number) => {
    hooks.onProgress({ phase, message, round, ratio });
  };

  let scene: CanvasElement[];
  if (options.startingScene && options.refineInstructions) {
    emit("fix", "Refining scene from instructions", 1, 0.05);
    hooks.onRoundPhase(1, "fix");
    scene = await generateValidatedScene(client, log, config, {
      apiKey,
      model: models.fix,
      script,
      timeoutMs,
      signal: options.signal,
      callType: "fix",
      initialPrompt: fixScenePrompt(
        script,
        JSON.stringify(options.startingScene, null, 2),
        "(user refine)",
        options.refineInstructions,
      ),
    });
  } else {
    emit("generate", "Generating scene JSON", 1, 0.05);
    hooks.onRoundPhase(1, "generate");
    scene = await generateValidatedScene(client, log, config, {
      apiKey,
      model: models.generate,
      script,
      timeoutMs,
      signal: options.signal,
      callType: "generate",
      initialPrompt: generateScenePrompt(script),
    });
  }

  type Best = { n: number; scene: CanvasElement[]; scores: ReviewScores | null; issues: ReviewIssue[] };
  let best: Best | null = null;

  for (let round = 1; round <= maxRounds; round += 1) {
    throwIfAborted(options.signal);
    if (round > 1) {
      const issues = best?.issues ?? [];
      emit("fix", `Fixing scene (round ${round})`, round, 0.35 + (round - 1) * 0.25);
      hooks.onRoundPhase(round, "fix");
      try {
        scene = await generateValidatedScene(client, log, config, {
          apiKey,
          model: models.fix,
          script,
          timeoutMs,
          signal: options.signal,
          callType: "fix",
          initialPrompt: fixScenePrompt(script, JSON.stringify(scene, null, 2), issuesText(issues)),
        });
      } catch (error) {
        if (error instanceof AppError && error.code === "SCHEMA_INVALID") {
          log.warn("Fix produced invalid scene; stopping rounds", { round });
          break;
        }
        throw error;
      }
    }

    emit("render", `Rendering keyframes (round ${round})`, round, 0.45 + (round - 1) * 0.2);
    hooks.onRoundPhase(round, "render");
    throwIfAborted(options.signal);
    const frames = renderKeyframes(
      scene,
      config.pipeline.maxKeyframes,
      config.render.width,
      config.render.height,
    );

    emit("review", `Reviewing keyframes (round ${round})`, round, 0.7 + (round - 1) * 0.1);
    hooks.onRoundPhase(round, "review");
    const review = await reviewOnce(client, {
      apiKey,
      model: models.review,
      script,
      times: frames.map((frame) => frame.time),
      pngs: frames.map((frame) => frame.png),
      timeoutMs,
      signal: options.signal,
    });
    const scores = scoresFrom(review);
    const pass = scores.overall >= passScore;
    store.saveRound({
      jobId,
      n: round,
      scene,
      scores,
      pass,
      issues: review.issues,
      keyframes: frames,
    });
    const candidate: Best = { n: round, scene, scores, issues: review.issues };
    best = betterRound(best, candidate) as Best;
    if (pass) break;
  }

  if (!best) {
    throw new AppError("UPSTREAM", "Pipeline finished without a scene");
  }
  store.updateJob(jobId, {
    status: "done",
    progress: { phase: "done", message: "Complete", round: best.n, ratio: 1 },
    result: { scene: best.scene, scores: best.scores, round: best.n },
    error: null,
  });
}

export { parseSceneEnvelope, reviewSchema };
