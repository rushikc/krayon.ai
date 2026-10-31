import { useState } from "react";

import { KeyframeLightbox } from "@/components/chat/KeyframeLightbox";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useReelChatStore } from "@/stores/reel-chat-store";
import {
  RETRYABLE_ERROR_CODES,
  friendlyErrorMessage,
  isErrorCode,
  type JobState,
  type RoundState,
} from "@/types/reel-pipeline";

const PHASES = ["generate", "render", "review", "fix", "done"] as const;

export function ChatRunCard({
  job,
  onApplied,
}: {
  job: JobState;
  onApplied: () => void;
}) {
  const cancelActive = useReelChatStore((state) => state.cancelActive);
  const retryJob = useReelChatStore((state) => state.retryJob);
  const applyRound = useReelChatStore((state) => state.applyRound);
  const running = job.status === "queued" || job.status === "running";
  const latestRound = job.rounds[job.rounds.length - 1]?.n ?? null;
  const [openRound, setOpenRound] = useState<number | null>(latestRound);
  const phase = job.status === "done" ? "done" : job.progress.phase;
  const errorCode = job.error && isErrorCode(job.error.code) ? job.error.code : null;
  const retryable = errorCode ? RETRYABLE_ERROR_CODES.includes(errorCode) : false;

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 text-sm">
      <ol className="flex flex-wrap gap-1.5" aria-label="Pipeline phases">
        {PHASES.map((item) => (
          <li
            key={item}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              item === phase
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground",
            )}
          >
            {item}
          </li>
        ))}
      </ol>
      <div aria-live="polite" className="text-xs text-muted-foreground">
        {job.progress.message || job.status}
        {job.progress.round > 0 ? ` · round ${job.progress.round}` : ""}
      </div>
      {running ? (
        <Progress value={Math.round(job.progress.ratio * 100)} className="h-1.5" />
      ) : null}
      {running ? (
        <Button type="button" size="sm" variant="outline" onClick={() => void cancelActive()}>
          Cancel
        </Button>
      ) : null}

      {job.rounds.map((round) => (
        <RoundSection
          key={round.n}
          job={job}
          round={round}
          open={openRound === round.n}
          onToggle={() => setOpenRound((current) => (current === round.n ? null : round.n))}
          onApply={() => {
            if (applyRound(job.id, round.n)) {
              onApplied();
            }
          }}
        />
      ))}

      {job.status === "done" && job.result ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-2">
          <p className="text-xs font-medium">
            Best round {job.result.round}, overall {job.result.scores?.overall ?? "—"}/10
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (applyRound(job.id, job.result!.round)) {
                  onApplied();
                }
              }}
            >
              Apply to timeline
            </Button>
          </div>
          <details className="text-[11px]">
            <summary className="cursor-pointer text-muted-foreground">Raw JSON</summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono whitespace-pre-wrap">
              {JSON.stringify(job.result.scene, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}

      {job.status === "cancelled" ? (
        <p className="text-xs text-muted-foreground">Cancelled</p>
      ) : null}

      {job.status === "error" ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-destructive">
            {errorCode
              ? friendlyErrorMessage(errorCode, job.error?.message)
              : job.error?.message || "The job failed."}
          </p>
          {retryable ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void retryJob(job.id)}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function RoundSection({
  job,
  round,
  open,
  onToggle,
  onApply,
}: {
  job: JobState;
  round: RoundState;
  open: boolean;
  onToggle: () => void;
  onApply: () => void;
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const overall = round.scores?.overall;
  const passLabel =
    round.pass === true ? "pass" : round.pass === false ? "fail" : "pending";

  return (
    <section className="rounded-md border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs font-medium"
      >
        <span>Round {round.n}</span>
        <span className="text-muted-foreground">
          {overall != null ? `${overall}/10` : "—"} · {passLabel}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-border p-2">
          {round.scores ? (
            <div className="flex flex-wrap gap-1">
              <ScoreChip label="clarity" value={round.scores.clarity} />
              <ScoreChip label="readability" value={round.scores.readability} />
              <ScoreChip label="accuracy" value={round.scores.accuracy} />
              <ScoreChip
                label="overall"
                value={round.scores.overall}
                pass={round.pass}
                threshold={job.passScore}
              />
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">Scores pending</p>
          )}
          {round.issues.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {round.issues.map((issue, index) => (
                <li key={`${issue.problem}-${index}`} className="text-[11px]">
                  <SeverityBadge severity={issue.severity} />{" "}
                  {issue.problem}
                  {issue.frameIndex != null ? (
                    <span className="text-muted-foreground"> · frame {issue.frameIndex}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {round.keyframes.length > 0 ? (
            <div className="flex gap-1 overflow-x-auto">
              {round.keyframes.map((frame, index) => (
                <button
                  key={frame.index}
                  type="button"
                  className="shrink-0 overflow-hidden rounded border border-border"
                  onClick={() => setLightbox(index)}
                >
                  <img
                    src={frame.url}
                    alt={`Round ${round.n} keyframe ${frame.index + 1}`}
                    className="h-20 w-auto aspect-[9/16] object-cover"
                  />
                </button>
              ))}
            </div>
          ) : null}
          {round.scene.length > 0 ? (
            <Button type="button" size="sm" variant="outline" onClick={onApply}>
              Apply round {round.n}
            </Button>
          ) : null}
          <KeyframeLightbox
            frames={round.keyframes}
            index={lightbox}
            onIndexChange={setLightbox}
            onClose={() => setLightbox(null)}
          />
        </div>
      ) : null}
    </section>
  );
}

function ScoreChip({
  label,
  value,
  pass,
  threshold,
}: {
  label: string;
  value: number;
  pass?: boolean | null;
  threshold?: number;
}) {
  return (
    <span
      className={cn(
        "rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        pass === true
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : pass === false
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : "border-border text-foreground",
      )}
    >
      {label} {value}/10
      {threshold != null ? ` (≥${threshold})` : ""}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: "low" | "medium" | "high" }) {
  return (
    <span
      className={cn(
        "rounded px-1 py-px text-[10px] font-medium uppercase",
        severity === "high" && "bg-destructive/15 text-destructive",
        severity === "medium" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        severity === "low" && "bg-muted text-muted-foreground",
      )}
    >
      {severity}
    </span>
  );
}
