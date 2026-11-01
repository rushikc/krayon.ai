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
  analyzeAudio: "Analyze audio",
  addSourceVideo: "Add a source video",
  rebuild: "Rebuild",
  rebuildFirst: "Run Analyze first",
  rebuildConfirmTitle: "Rebuild from saved transcript?",
  rebuildConfirm:
    "This regroups and rescores from the saved transcript without re-transcribing. Clip ids are replaced and accept/reject decisions are reset.",
  rebuildConfirmAction: "Rebuild",
  rebuildWithScript: "Rebuild with script",
  rebuildWithoutScript: "Rebuild without script",
  scriptOptional: "Script (optional)",
  scriptLines: (count: number) => `${count} line${count === 1 ? "" : "s"}`,
  saveScript: "Save script",
  needsRebuild: "Script changed. Rebuild to apply.",
  pipelineScripted: (lines: number) => `Scripted · ${lines} lines`,
  pipelineTranscript: "Transcript only",
  pipelineStats: (lines: number, matched: number, missing: number) =>
    `${lines} lines · ${matched} matched · ${missing} missing`,
  lineNotFound: (line: number) => `Line ${line} not found`,
  cancel: "Cancel",
  delete: "Delete",
  deleteAll: "Delete all",
  deleteProjectNamed: (name: string) => `Delete project ${name}`,
  deleteConfirmTitle: (name: string) => `Delete ${name}?`,
  deleteConfirm:
    "This removes its cuts, history, transcript and renders from Studio. Your original video is not touched.",
  deleteAllConfirm: (count: number) =>
    `Delete ${count} project${count === 1 ? "" : "s"}? This removes every Studio project folder. Original videos are not touched.`,
  deleteAllTypeLabel: "Type DELETE to confirm",
  nameTaken: "A project with this name already exists",
  projectDeleted: "That project was deleted.",
  analyzingTitle: "Analyzing",
  resetStatus: "Reset status",
  reusingCachedAudio: "Reusing cached audio",
  reusingCachedTranscript: "Reusing cached transcript",
  analyzing: "Analyzing…",
  startingAnalysis: "Starting analysis",
  readyToAnalyze: "Import is ready. Run Analyze audio to transcribe and group takes.",
  analyzeFailed: "Analysis failed",
  retry: "Retry",
  editing: "Editing",
  addCut: "Add cut at playhead",
  pressS: "Press S to cut",
  undoLastCut: "Undo last cut",
  saveCuts: (cuts: number) => `Save (${cuts} cuts → ${cuts + 1} clips)`,
  splitToast: (count: number) => `Split into ${count} clips`,
  discardCuts: "Discard unsaved cuts?",
  cutTooClose: "Cut is too close to the clip start, end, or another cut",
  splitConflict: "This cut changed. Reloaded the clip. Retry Save.",
  analysisProgress: "Analysis",
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
      if (name === "split" || name === "splitMany") return `split ${String(op.clipId ?? "")}`.trim();
      if (name === "merge" && Array.isArray(op.clipIds)) return `merge ${op.clipIds.join(" ")}`;
      if (name === "trim") return `trim ${String(op.clipId ?? "")}`.trim();
      if (name === "note") return `note ${String(op.clipId ?? "")}`.trim();
      if (name === "annotate") return `annotate ${String(op.clipId ?? "")}`.trim();
      return name;
    })
    .filter(Boolean)
    .join(", ");
}
