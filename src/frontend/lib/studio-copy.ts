export type ClipSummary = {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  text: string;
};

export function describeClips(clips: ClipSummary[]): string {
  return clips
    .map((clip) => `${clip.id} ${clip.sourceStart.toFixed(2)}-${clip.sourceEnd.toFixed(2)}s ${clip.text}`)
    .join("\n");
}

export function describeIds(ids: string[]): string {
  return ids.join(" ");
}

export const studioCopy = {
  pendingBadge: (count: number) => (count === 1 ? "1 pending ask" : `${count} pending asks`),
  recentDecisions: "Recent decisions",
  notePlaceholder: "Optional note for Grok",
  staleResult: "Project changed, ask Grok to re-propose",
  appliedResult: "Applied",
  declinedResult: "Declined",
  dismiss: "Dismiss",
};

export function describeOpsPreview(ops: Array<Record<string, unknown>> | undefined): string {
  if (!ops?.length) return "";
  return ops
    .map((op) => {
      const name = String(op.op ?? "");
      if (name === "select" || name === "reject" || name === "undecided") return `${name} ${String(op.clipId ?? "")}`.trim();
      if (name === "split") return `split ${String(op.clipId ?? "")}`.trim();
      if (name === "merge" && Array.isArray(op.clipIds)) return `merge ${op.clipIds.join(" ")}`;
      if (name === "trim") return `trim ${String(op.clipId ?? "")}`.trim();
      if (name === "note") return `note ${String(op.clipId ?? "")}`.trim();
      return name;
    })
    .filter(Boolean)
    .join(", ");
}
