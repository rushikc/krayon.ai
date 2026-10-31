import { type Clip, type Cuts, playRanges } from "./types.js";

export type LintWarning = {
  code: string;
  message: string;
  clipId?: string;
  groupId?: string;
};

const SHORT_SECONDS = 0.35;

function wordCut(clip: Clip, edge: "start" | "end"): boolean {
  const time = edge === "start" ? clip.sourceStart : clip.sourceEnd;
  return clip.words.some((word) => word.start + 0.02 < time && time < word.end - 0.02);
}

export type EdgeLevels = { rmsDbfs: number; peakDbfs: number };

export type AudioEdgeStats = {
  start: EdgeLevels;
  end: EdgeLevels;
};

const EDGE_LOUD_DBFS = -35;

export function lintCuts(doc: Cuts, stats?: Record<string, AudioEdgeStats>): LintWarning[] {
  const warnings: LintWarning[] = [];
  for (const clip of doc.clips) {
    if (clip.duration < SHORT_SECONDS) {
      warnings.push({
        code: "short_clip",
        clipId: clip.id,
        message: `${clip.id} is very short (${clip.duration.toFixed(2)}s)`,
      });
    }
    if (clip.status === "selected" && clip.label !== "none") {
      warnings.push({
        code: "selected_weak",
        clipId: clip.id,
        message: `${clip.id} is selected but labelled ${clip.label}`,
      });
    }
    if (wordCut(clip, "start") || wordCut(clip, "end")) {
      warnings.push({
        code: "mid_word",
        clipId: clip.id,
        message: `${clip.id} is cut in the middle of a word`,
      });
    }
    const edge = stats?.[clip.id];
    if (edge && (edge.start.rmsDbfs > EDGE_LOUD_DBFS || edge.end.rmsDbfs > EDGE_LOUD_DBFS)) {
      warnings.push({
        code: "edge_loud",
        clipId: clip.id,
        message: `${clip.id} starts or ends louder than ${EDGE_LOUD_DBFS} dBFS`,
      });
    }
  }

  for (const group of doc.groups) {
    const selected = group.clipIds.filter((id) => doc.clips.find((clip) => clip.id === id)?.status === "selected");
    if (selected.length === 0) {
      warnings.push({
        code: "group_unselected",
        groupId: group.id,
        message: `${group.id} has no selected take`,
      });
    }
    if (selected.length > 1) {
      warnings.push({
        code: "duplicate_line",
        groupId: group.id,
        message: `${group.id} still has more than one selected take (${selected.join(", ")})`,
      });
    }
  }

  const ordered = doc.order
    .map((id) => doc.clips.find((clip) => clip.id === id))
    .filter((clip): clip is Clip => clip != null);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    const gap = current.sourceStart - previous.sourceEnd;
    if (gap > 2) {
      warnings.push({
        code: "gap",
        clipId: current.id,
        message: `${gap.toFixed(2)}s source gap before ${current.id}`,
      });
    }
    const prevRanges = playRanges(previous);
    const currRanges = playRanges(current);
    const prevEnd = prevRanges[prevRanges.length - 1]!.sourceEnd;
    const currStart = currRanges[0]!.sourceStart;
    if (currStart < prevEnd - 0.05) {
      warnings.push({
        code: "overlap",
        clipId: current.id,
        message: `${previous.id} and ${current.id} overlap in the cut`,
      });
    }
  }
  return warnings;
}
