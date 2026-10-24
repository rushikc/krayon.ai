import type { CanvasElement } from "./canvas/types.js";
import type { ReviewIssue, ReviewScores } from "./schema/scene.js";

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export type JobModels = {
  generate: string;
  review: string;
  fix: string;
};

export type JobProgress = {
  phase: string;
  message: string;
  round: number;
  ratio: number;
};

export type RoundKeyframe = {
  index: number;
  time: number;
  url: string;
};

export type RoundState = {
  n: number;
  scene: CanvasElement[];
  scores: ReviewScores | null;
  pass: boolean | null;
  issues: ReviewIssue[];
  keyframes: RoundKeyframe[];
};

export type JobError = {
  code: string;
  message: string;
};

export type JobResult = {
  scene: CanvasElement[];
  scores: ReviewScores | null;
  round: number;
};

export type JobState = {
  id: string;
  status: JobStatus;
  script: string;
  parentJobId?: string;
  refineInstructions?: string;
  maxRounds: number;
  passScore: number;
  models: JobModels;
  progress: JobProgress;
  rounds: RoundState[];
  result?: JobResult;
  error?: JobError;
  createdAt: string;
  updatedAt: string;
};

export type JobSummary = {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  parentJobId?: string;
  error?: JobError;
};

export type ReelEvent =
  | { type: "snapshot"; job: JobState }
  | { type: "progress"; phase: string; message: string; round: number; ratio: number }
  | { type: "round"; round: number; phase: "generate" | "render" | "review" | "fix" }
  | { type: "done"; job: JobState }
  | { type: "error"; code: string; message: string }
  | { type: "cancelled" };
