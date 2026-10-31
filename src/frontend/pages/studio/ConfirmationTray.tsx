import { useEffect, useState } from "react";

import type { ConfirmationItem } from "@/lib/api/studio-client";
import { describeOpsPreview, studioCopy } from "@/lib/studio-copy";

function StudioMarkdown({ text }: { text: string }) {
  const nodes = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g).map((part, index) => {
    if (part === "\n") return <br key={index} />;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  });
  return <>{nodes}</>;
}

export function ConfirmationTray({
  items,
  highlightId,
  busyId,
  onAnswer,
  onSelectClip,
  onDismiss,
}: {
  items: ConfirmationItem[];
  highlightId?: string | null;
  busyId?: string | null;
  onAnswer: (item: ConfirmationItem, optionId: string, note: string) => void;
  onSelectClip: (id: string) => void;
  onDismiss: () => void;
}) {
  const pending = items.filter((item) => item.status === "pending").sort((a, b) => a.seq - b.seq);
  const oldest = pending[0] ?? null;
  const recent = items
    .filter((item) => item.status !== "pending")
    .sort((a, b) => Date.parse(b.answer?.at ?? b.createdAt) - Date.parse(a.answer?.at ?? a.createdAt))
    .slice(0, 20);
  const [note, setNote] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!oldest) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
      if (event.key === "Enter" && !event.shiftKey) {
        const primary = oldest.options.find((option) => option.style === "primary") ?? oldest.options[0];
        if (primary) {
          event.preventDefault();
          onAnswer(oldest, primary.id, note);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [oldest, note, onAnswer, onDismiss]);

  return (
    <div className="space-y-2">
      {oldest ? (
        <article
          data-testid="confirmation-card"
          className={`rounded-md border border-border p-3 text-xs ${highlightId === oldest.id ? "animate-pulse bg-primary/10" : "bg-muted/30"}`}
        >
          <h2 className="font-medium">{oldest.title}</h2>
          {oldest.message ? (
            <p className="mt-1 text-muted-foreground">
              <StudioMarkdown text={oldest.message} />
            </p>
          ) : null}
          {oldest.clipIds.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {oldest.clipIds.map((id) => (
                <button key={id} type="button" className="rounded bg-primary/15 px-1.5 py-0.5 font-mono" onClick={() => onSelectClip(id)}>
                  {id}
                </button>
              ))}
            </div>
          ) : null}
          {oldest.proposedOps?.ops?.length ? (
            <p className="mt-2 text-muted-foreground">{describeOpsPreview(oldest.proposedOps.ops)}</p>
          ) : null}
          {oldest.allowNote ? (
            <input
              className="mt-2 w-full rounded border border-border bg-background px-2 py-1"
              placeholder={studioCopy.notePlaceholder}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {oldest.options.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={busyId === oldest.id}
                className={
                  option.style === "danger"
                    ? "rounded bg-destructive px-2 py-1 text-destructive-foreground"
                    : option.style === "primary"
                      ? "rounded bg-primary px-2 py-1 text-primary-foreground"
                      : "rounded border border-border px-2 py-1"
                }
                onClick={() => onAnswer(oldest, option.id, note)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </article>
      ) : null}
      {recent.length ? (
        <div>
          <p className="mb-1 font-medium">{studioCopy.recentDecisions}</p>
          <ul className="space-y-1 text-muted-foreground">
            {recent.map((item) => (
              <li key={item.id}>
                {item.title} · {item.answer?.optionId ?? item.status}
                {item.result?.error === "stale_revision" ? ` · ${studioCopy.staleResult}` : ""}
                {item.result?.applied ? ` · ${studioCopy.appliedResult}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function pendingLabel(count: number) {
  return studioCopy.pendingBadge(count);
}
