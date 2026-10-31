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
  backToLibrary: "Back to library",
  stepAudio: "1 Audio",
  stepVideo: "2 Video",
  comingSoon: "Coming soon",
  clips: "Clips",
  accepted: "Accepted",
  notAccepted: "Not accepted",
  rejected: "Rejected",
  undecided: "Undecided",
  summary: (accepted: number, notAccepted: number) => `${accepted} accepted · ${notAccepted} not accepted`,
  groupAccepted: (accepted: number, total: number) => `${accepted}/${total} accepted`,
  copyId: "Copy clip id",
  copySentence: "Copy clip id and text",
  clipAudio: "Clip audio",
  renderedVideo: "Rendered video",
  fullVideo: "Full video",
  accept: "Accept",
  reject: "Reject",
  clipData: "Clip data",
  rawJson: "Raw JSON",
  copyJson: "Copy JSON",
  previousClip: "Previous clip",
  nextClip: "Next clip",
  conflict: "This cut changed. Reloaded the clip.",
  controls: "Controls",
  settings: "Settings",
  edit: "Edit",
  done: "Done",
  silenceThreshold: "Silence threshold (s)",
  pad: "Pad (s)",
  similarity: "Similarity threshold",
  analysisRun: "Analysis run",
  currentAnalysis: "Current analysis",
  backendTools: "Backend tools",
  refresh: "Refresh",
  showAllSegments: "Show all segments",
  viewTranscript: "View transcript",
  renderPreview: "Render preview",
  renderFinal: "Render final video",
  cancelRender: "Cancel render",
  recentRenders: "Recent renders",
  selectedSummary: (count: number, clock: string) => `${count} clips selected, about ${clock} total`,
  lintWarnings: "Lint warnings",
  renderReady: "Render ready, open",
  copyPath: "Copy path",
  playRender: "Play",
  searchTranscript: "Search transcript",
  noClipSelected: "Select a clip from the sidebar to preview audio.",
  decidedBy: (actor: string) => `Decided by ${actor}`,
  toolsReady: (ffmpeg: boolean, ffprobe: boolean, whisper: boolean) =>
    `Backend tools: ffmpeg / ffprobe / whisper: ${ffmpeg && ffprobe && whisper ? "ready" : "missing"}`,
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
      if (name === "annotate") return `annotate ${String(op.clipId ?? "")}`.trim();
      return name;
    })
    .filter(Boolean)
    .join(", ");
}
