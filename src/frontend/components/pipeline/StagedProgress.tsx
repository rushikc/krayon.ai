import { Check, Circle, Loader2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";

export type StagedProgressStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
  stepProgress: number;
  message: string | null;
};

export function StagedProgress({
  title,
  message,
  progress,
  steps,
  startedAt,
  error,
  children,
}: {
  title: string;
  message?: string | null;
  progress: number;
  steps: StagedProgressStep[];
  startedAt?: number | null;
  error?: string | null;
  children?: ReactNode;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return (
    <main className="flex min-w-0 flex-1 flex-col items-center justify-center bg-background p-8">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{message ?? "Running pipeline…"}</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Overall progress</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          {startedAt ? (
            <p className="text-center text-xs text-muted-foreground">Elapsed {formatDuration(elapsed)}</p>
          ) : null}
        </div>

        <ol className="space-y-0">
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            const pct = Math.round(step.stepProgress * 100);
            return (
              <li key={step.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <StepIcon status={step.status} />
                  {!isLast && (
                    <div
                      className={cn(
                        "my-1 w-px min-h-6 flex-1 transition-colors",
                        step.status === "done" ? "bg-primary/50" : "bg-border",
                      )}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1 pb-5">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        step.status === "pending" && "text-muted-foreground",
                        step.status === "active" && "text-foreground",
                        step.status === "done" && "text-foreground",
                        step.status === "error" && "text-destructive",
                      )}
                    >
                      {step.label}
                    </p>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {step.status === "done" ? "100%" : step.status === "active" ? `${pct}%` : "—"}
                    </span>
                  </div>
                  {step.status === "active" ? (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/80 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  ) : null}
                  {step.message && step.status === "active" ? (
                    <p className="mt-1 truncate text-xs text-muted-foreground">{step.message}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        ) : null}
        {children}
      </div>
    </main>
  );
}

function StepIcon({ status }: { status: "pending" | "active" | "done" | "error" }) {
  if (status === "active") {
    return <Loader2 className="size-5 shrink-0 animate-spin text-primary" />;
  }
  if (status === "done") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20">
        <Check className="size-3 text-primary" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/20">
        <X className="size-3 text-destructive" />
      </span>
    );
  }
  return <Circle className="size-5 shrink-0 text-muted-foreground/40" />;
}
