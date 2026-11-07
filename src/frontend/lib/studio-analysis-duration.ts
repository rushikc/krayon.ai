import type { HistoryItem, StudioProject } from "@/lib/api/studio-client";

const ANALYSIS_HISTORY_LABELS = new Set(["analyze", "retranscribe", "resegment", "regroup"]);

function durationFromTimestamps(startedRaw: string | null | undefined, endedRaw: string | null | undefined): number | null {
  if (!startedRaw || !endedRaw) return null;
  const started = Date.parse(startedRaw);
  const ended = Date.parse(endedRaw);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return null;
  const seconds = Math.round((ended - started) / 1000);
  return seconds > 0 ? seconds : null;
}

function lastAnalysisFinishedAt(history: HistoryItem[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (ANALYSIS_HISTORY_LABELS.has(entry.label)) return entry.at;
  }
  return null;
}

export function resolveAnalysisDurationSeconds(
  project: Pick<StudioProject, "meta" | "history" | "hasTranscript" | "analysisStartedAt">,
): number | null {
  const saved = project.meta.analysisDurationSeconds;
  if (typeof saved === "number" && Number.isFinite(saved) && saved >= 0) return saved;
  if (!project.hasTranscript) return null;
  const started = project.meta.analysisStartedAt ?? project.analysisStartedAt;
  return durationFromTimestamps(started, lastAnalysisFinishedAt(project.history));
}
