import { studioCopy } from "@/lib/studio-copy";

export type StepStatus = "pending" | "active" | "done" | "error";

export type StudioPipelineStep = {
  id: string;
  label: string;
  status: StepStatus;
  stepProgress: number;
  message: string | null;
};

export type StudioRunMode = "analyze" | "retranscribe" | "resegment" | "regroup";

const PHASE_ORDER = ["extracting", "transcribing", "segmenting", "grouping", "snapping", "saving"] as const;

export function studioStepDefs(pipeline: "transcript" | "scripted", snapToAudio: boolean) {
  const scripted = pipeline === "scripted";
  const steps = [
    { id: "extracting", label: "Extract audio" },
    { id: "transcribing", label: "Transcribe" },
    { id: "segmenting", label: scripted ? "Align to script" : "Cut by silence" },
    { id: "grouping", label: scripted ? "Match script lines to takes" : "Group retakes" },
  ];
  if (snapToAudio) steps.push({ id: "snapping", label: "Snap cuts to the waveform" });
  steps.push({ id: "saving", label: "Save clips" });
  return steps;
}

export function initialStudioSteps(
  pipeline: "transcript" | "scripted",
  snapToAudio: boolean,
  mode: StudioRunMode = "analyze",
  hasTranscript = false,
): StudioPipelineStep[] {
  const reuseEarly = mode === "resegment" && hasTranscript;
  return studioStepDefs(pipeline, snapToAudio).map((def) => {
    if (mode === "retranscribe" && def.id === "extracting") {
      return { ...def, status: "done" as const, stepProgress: 1, message: studioCopy.reusingCachedAudio };
    }
    if (reuseEarly && (def.id === "extracting" || def.id === "transcribing")) {
      return {
        ...def,
        status: "done" as const,
        stepProgress: 1,
        message: def.id === "extracting" ? studioCopy.reusingCachedAudio : studioCopy.reusingCachedTranscript,
      };
    }
    if (mode === "regroup" && (def.id === "extracting" || def.id === "transcribing" || def.id === "segmenting")) {
      return { ...def, status: "done" as const, stepProgress: 1, message: studioCopy.reusingCachedTranscript };
    }
    return { ...def, status: "pending" as const, stepProgress: 0, message: null };
  });
}

export function applyStudioPhase(
  steps: StudioPipelineStep[],
  phase: string,
  ratio = 0,
  message?: string | null,
): StudioPipelineStep[] {
  const idx = steps.findIndex((step) => step.id === phase);
  if (idx < 0) return steps;
  const progress = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  return steps.map((step, index) => {
    if (index < idx) return { ...step, status: "done" as const, stepProgress: 1 };
    if (index === idx) {
      return {
        ...step,
        status: progress >= 1 ? ("done" as const) : ("active" as const),
        stepProgress: progress,
        message: message ?? step.message,
      };
    }
    return { ...step, status: "pending" as const, stepProgress: 0, message: null };
  });
}

export function markActiveStepError(steps: StudioPipelineStep[], message: string): StudioPipelineStep[] {
  const active = steps.findIndex((step) => step.status === "active");
  const pending = steps.findIndex((step) => step.status === "pending");
  const idx = active >= 0 ? active : pending;
  if (idx < 0) return steps;
  return steps.map((step, index) =>
    index === idx ? { ...step, status: "error" as const, message } : step,
  );
}

export function overallStudioProgress(steps: StudioPipelineStep[]): number {
  if (steps.length === 0) return 0;
  const done = steps.filter((step) => step.status === "done").length;
  const active = steps.find((step) => step.status === "active");
  return (done + (active?.stepProgress ?? 0)) / steps.length;
}

export function phaseIndex(phase: string): number {
  return PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number]);
}
