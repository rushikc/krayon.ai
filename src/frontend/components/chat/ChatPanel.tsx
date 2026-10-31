import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { ChatRunCard } from "@/components/chat/ChatRunCard";
import { GeminiKeyDialog } from "@/components/chat/GeminiKeyDialog";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useReelChatStore } from "@/stores/reel-chat-store";
import { cn } from "@/lib/utils";
import type { JobStatus } from "@/types/reel-pipeline";

const EXAMPLE_SCRIPTS = [
  "Explain how a REST API request flows from the client to the database in three steps.",
  "Show the difference between CPU and GPU with two boxes and an arrow.",
  "Walk through binary search on a sorted list, one comparison at a time.",
];

export function ChatPanel({ onApplied }: { onApplied: () => void }) {
  const healthOk = useReelChatStore((state) => state.healthOk);
  const jobIds = useReelChatStore((state) => state.jobIds);
  const jobsById = useReelChatStore((state) => state.jobsById);
  const historyJobs = useReelChatStore((state) => state.historyJobs);
  const keyDialogOpen = useReelChatStore((state) => state.keyDialogOpen);
  const send = useReelChatStore((state) => state.send);
  const cancelActive = useReelChatStore((state) => state.cancelActive);
  const newChat = useReelChatStore((state) => state.newChat);
  const refreshHistory = useReelChatStore((state) => state.refreshHistory);
  const loadJobFromHistory = useReelChatStore((state) => state.loadJobFromHistory);
  const setKeyDialogOpen = useReelChatStore((state) => state.setKeyDialogOpen);
  const continuePendingSend = useReelChatStore((state) => state.continuePendingSend);
  const running = jobIds.some((id) => {
    const job = jobsById[id];
    return job?.status === "queued" || job?.status === "running";
  });
  const hasCompleted = jobIds.some((id) => jobsById[id]?.status === "done");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [jobIds, jobsById]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="text-sm font-semibold">Reel assistant</h2>
        <div className="ml-auto flex items-center gap-1.5">
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshHistory()}
                />
              }
            >
              History
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <p className="text-xs font-medium">Jobs</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void refreshHistory()}
              >
                Refresh
              </Button>
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {historyJobs.length === 0 ? (
                  <li className="text-xs text-muted-foreground">No jobs yet</li>
                ) : (
                  historyJobs.map((job) => (
                    <li key={job.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onClick={() => void loadJobFromHistory(job.id)}
                      >
                        <span className="min-w-0 truncate font-mono">
                          {job.id.slice(0, 8)}
                        </span>
                        <StatusChip status={job.status} />
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {formatTime(job.createdAt)}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </PopoverContent>
          </Popover>
          <Button type="button" size="sm" variant="outline" onClick={newChat}>
            New chat
          </Button>
        </div>
      </header>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        aria-live="polite"
      >
        {healthOk === false ? (
          <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
            Reel backend isn't running. Run `pnpm dev`.
          </p>
        ) : jobIds.length === 0 ? (
          <EmptyState
            disabled={false}
            onPick={(script) => void send(script, { forceNewScript: true })}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {jobIds.map((id) => {
              const job = jobsById[id];
              if (!job) {
                return null;
              }
              const userText = job.refineInstructions ?? job.script;
              return (
                <div key={id} className="flex flex-col gap-2">
                  <div className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground">
                    {userText}
                  </div>
                  <ChatRunCard job={job} onApplied={onApplied} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Composer
        disabled={healthOk === false}
        running={running}
        hasCompleted={hasCompleted}
        onSend={(text, forceNewScript) => void send(text, { forceNewScript })}
        onStop={() => void cancelActive()}
      />

      <GeminiKeyDialog
        open={keyDialogOpen}
        onOpenChange={setKeyDialogOpen}
        onSaved={() => void continuePendingSend()}
      />
    </div>
  );
}

function EmptyState({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (script: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Paste a teaching script. The local reel pipeline generates a 9:16 scene,
        scores it, and can apply the result to the timeline.
      </p>
      <div className="flex flex-col gap-1.5">
        {EXAMPLE_SCRIPTS.map((script) => (
          <button
            key={script}
            type="button"
            disabled={disabled}
            onClick={() => onPick(script)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {script}
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({
  disabled,
  running,
  hasCompleted,
  onSend,
  onStop,
}: {
  disabled: boolean;
  running: boolean;
  hasCompleted: boolean;
  onSend: (text: string, forceNewScript: boolean) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const [forceNew, setForceNew] = useState(false);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) {
      return;
    }
    onSend(text, forceNew || !hasCompleted);
    setValue("");
    setForceNew(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (running) {
        return;
      }
      submit();
    }
  };

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-border p-2">
      {hasCompleted ? (
        <button
          type="button"
          className="self-start text-[11px] text-primary underline-offset-4 hover:underline"
          onClick={() => setForceNew(true)}
        >
          Start from a new script
        </button>
      ) : null}
      {forceNew ? (
        <p className="text-[11px] text-muted-foreground">
          Next message starts a new script.
        </p>
      ) : null}
      <textarea
        aria-label="Chat message"
        rows={3}
        disabled={disabled || running}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          hasCompleted && !forceNew
            ? "Describe how to refine the scene"
            : "Paste a teaching script"
        }
        className="min-h-[4.5rem] w-full resize-none rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      />
      <div className="flex justify-end">
        {running ? (
          <Button type="button" size="sm" variant="outline" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={disabled || !value.trim()} onClick={submit}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: JobStatus }) {
  return (
    <span
      className={cn(
        "rounded-md border px-1.5 py-0.5 text-[10px] font-medium capitalize",
        status === "done" && "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
        status === "error" && "border-destructive/40 text-destructive",
        status === "cancelled" && "text-muted-foreground",
        (status === "running" || status === "queued") &&
          "border-primary/40 text-primary",
      )}
    >
      {status}
    </span>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
