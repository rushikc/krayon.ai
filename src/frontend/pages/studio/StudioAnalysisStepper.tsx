import { Button } from "@/components/ui/button";
import { StagedProgress, type StagedProgressStep } from "@/components/pipeline/StagedProgress";
import { studioCopy } from "@/lib/studio-copy";
import { overallStudioProgress } from "@/lib/studio-analysis-steps";

export function StudioAnalysisStepper({
  message,
  steps,
  startedAt,
  error,
  onRetry,
  onReset,
}: {
  message?: string | null;
  steps: StagedProgressStep[];
  startedAt?: number | null;
  error?: string | null;
  onRetry?: () => void;
  onReset?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1" data-testid="studio-analysis-stepper">
      <StagedProgress
        title={studioCopy.analyzingTitle}
        message={message}
        progress={overallStudioProgress(steps)}
        steps={steps}
        startedAt={startedAt}
        error={error}
      >
        {error ? (
          <div className="flex flex-wrap justify-center gap-2">
            {onRetry ? (
              <Button type="button" onClick={onRetry}>
                {studioCopy.retry}
              </Button>
            ) : null}
            {onReset ? (
              <Button type="button" variant="outline" onClick={onReset}>
                {studioCopy.resetStatus}
              </Button>
            ) : null}
          </div>
        ) : null}
      </StagedProgress>
    </div>
  );
}
