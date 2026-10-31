import type { CanvasElement } from "@/types/canvas";

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "BAD_API_KEY"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "QUOTA"
  | "MAX_TOKENS"
  | "SAFETY_BLOCKED"
  | "SCHEMA_INVALID"
  | "NOT_JSON"
  | "TIMEOUT"
  | "CANCELLED"
  | "UPSTREAM";

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

export type ReviewIssue = {
  problem: string;
  severity: "low" | "medium" | "high";
  frameIndex?: number;
};

export type ReviewScores = {
  clarity: number;
  readability: number;
  accuracy: number;
  overall: number;
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

export type CreateJobBody = {
  script: string;
  maxRounds?: number;
  models?: Partial<JobModels>;
};

export type RefineJobBody = {
  instructions: string;
  maxRounds?: number;
  models?: Partial<JobModels>;
};

export const RETRYABLE_ERROR_CODES: readonly ErrorCode[] = [
  "RATE_LIMITED",
  "QUOTA",
  "TIMEOUT",
  "UPSTREAM",
];

export const KEY_ERROR_CODES: readonly ErrorCode[] = [
  "UNAUTHORIZED",
  "BAD_API_KEY",
];

export function isErrorCode(value: string): value is ErrorCode {
  return (
    value === "BAD_REQUEST" ||
    value === "UNAUTHORIZED" ||
    value === "BAD_API_KEY" ||
    value === "NOT_FOUND" ||
    value === "CONFLICT" ||
    value === "RATE_LIMITED" ||
    value === "QUOTA" ||
    value === "MAX_TOKENS" ||
    value === "SAFETY_BLOCKED" ||
    value === "SCHEMA_INVALID" ||
    value === "NOT_JSON" ||
    value === "TIMEOUT" ||
    value === "CANCELLED" ||
    value === "UPSTREAM"
  );
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "done" || status === "error" || status === "cancelled";
}

export function friendlyErrorMessage(code: ErrorCode, fallback?: string): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "Add a Gemini API key in Settings to generate reels.";
    case "BAD_API_KEY":
      return "That Gemini API key was rejected. Check it in Settings.";
    case "BAD_REQUEST":
      return "The request was invalid.";
    case "NOT_FOUND":
      return "That job was not found.";
    case "CONFLICT":
      return "This job can't take that action right now.";
    case "SCHEMA_INVALID":
      return "Gemini returned a scene that didn't match the schema.";
    case "NOT_JSON":
      return "Gemini didn't return JSON.";
    case "RATE_LIMITED":
      return "Gemini rate limit hit. Try again in a moment.";
    case "QUOTA":
      return "Gemini quota exceeded.";
    case "MAX_TOKENS":
      return "The model hit its token limit.";
    case "SAFETY_BLOCKED":
      return "Gemini blocked the content.";
    case "TIMEOUT":
      return "The request timed out.";
    case "CANCELLED":
      return "The job was cancelled.";
    case "UPSTREAM":
      return fallback?.trim() ? fallback : "The reel backend hit an upstream error.";
  }
}
