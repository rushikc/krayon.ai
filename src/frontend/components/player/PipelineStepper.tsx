import { StagedProgress } from "@/components/pipeline/StagedProgress";
import { useSilenceStore } from "@/stores/silence-store";

export function PipelineStepper() {
  const { pipelineSteps, progress, message, error, jobStartedAt } = useSilenceStore();
  return (
    <StagedProgress
      title="Analyzing silence"
      message={message}
      progress={progress}
      steps={pipelineSteps}
      startedAt={jobStartedAt}
      error={error}
    />
  );
}
