import type { JobState, ReelEvent } from "@/types/reel-pipeline";

export function applyReelEvent(
  job: JobState | null,
  event: ReelEvent,
): JobState | null {
  switch (event.type) {
    case "snapshot":
    case "done":
      return event.job;
    case "progress": {
      if (!job) {
        return job;
      }
      return {
        ...job,
        status: job.status === "queued" ? "running" : job.status,
        progress: {
          phase: event.phase,
          message: event.message,
          round: event.round,
          ratio: event.ratio,
        },
      };
    }
    case "round": {
      if (!job) {
        return job;
      }
      return {
        ...job,
        status: job.status === "queued" ? "running" : job.status,
        progress: {
          ...job.progress,
          phase: event.phase,
          round: event.round,
        },
      };
    }
    case "error": {
      if (!job) {
        return job;
      }
      return {
        ...job,
        status: "error",
        error: { code: event.code, message: event.message },
      };
    }
    case "cancelled": {
      if (!job) {
        return job;
      }
      return {
        ...job,
        status: "cancelled",
        error: job.error ?? { code: "CANCELLED", message: "The job was cancelled." },
      };
    }
  }
}

export function isTerminalReelEvent(event: ReelEvent): boolean {
  return event.type === "done" || event.type === "error" || event.type === "cancelled";
}
