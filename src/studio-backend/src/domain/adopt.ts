import { applyAlgorithmCut } from "./ops.js";
import {
  type Clip,
  type ClipLabel,
  type Cuts,
  type Group,
  type IdState,
  type SourceRange,
  type Word,
  iou,
  mintClipId,
  mintGroupId,
  overlaps,
  rangeDuration,
  textFromWords,
} from "./types.js";

const LABELS = new Set<ClipLabel>([
  "falseStart",
  "cut_off",
  "starts_late",
  "missing_words",
  "misstatement",
  "none",
]);

export type PyClip = {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  duration?: number;
  text: string;
  groupId: string;
  words?: Word[];
  falseStart?: boolean;
  deliveryIssue?: string | null;
  ranges?: SourceRange[];
  status?: Clip["status"];
  decidedBy?: Clip["decidedBy"];
  statusReason?: string;
  script?: Clip["script"];
};

export type PyGroup = {
  id: string;
  label?: string;
  clipIds: string[];
  referenceClipId?: string | null;
  scriptLine?: number;
};

export type AnalysisPayload = {
  clips: PyClip[];
  groups: PyGroup[];
  scores?: Record<string, { score?: number; reasons?: string[] }>;
  scope?: "full" | "range";
  rangeStart?: number | null;
  rangeEnd?: number | null;
  pipeline?: string;
};

export function labelFromPy(clip: PyClip): ClipLabel {
  if (clip.falseStart) return "falseStart";
  if (clip.deliveryIssue && LABELS.has(clip.deliveryIssue as ClipLabel)) {
    return clip.deliveryIssue as ClipLabel;
  }
  return "none";
}

function outer(clip: PyClip): SourceRange {
  const ranges = clip.ranges?.length
    ? clip.ranges
    : [{ sourceStart: clip.sourceStart, sourceEnd: clip.sourceEnd }];
  return {
    sourceStart: Math.min(...ranges.map((range) => range.sourceStart)),
    sourceEnd: Math.max(...ranges.map((range) => range.sourceEnd)),
  };
}

function greedyMatch(existing: Clip[], incoming: PyClip[]): Map<string, Clip> {
  const pool = [...existing];
  const matched = new Map<string, Clip>();
  const ordered = [...incoming].sort((a, b) => outer(b).sourceEnd - outer(b).sourceStart - (outer(a).sourceEnd - outer(a).sourceStart));
  for (const clip of ordered) {
    let best: Clip | null = null;
    let bestScore = 0.7;
    const span = outer(clip);
    for (const candidate of pool) {
      const score = iou(span, { sourceStart: candidate.sourceStart, sourceEnd: candidate.sourceEnd });
      if (score >= bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best) {
      matched.set(clip.id, best);
      const index = pool.indexOf(best);
      pool.splice(index, 1);
    }
  }
  return matched;
}

function studioGroupForCluster(
  pyClips: PyClip[],
  matched: Map<string, Clip>,
  ids: IdState,
  regroup: boolean,
): string {
  const votes = new Map<string, number>();
  for (const clip of pyClips) {
    const hit = matched.get(clip.id);
    if (!hit) continue;
    votes.set(hit.groupId, (votes.get(hit.groupId) ?? 0) + 1);
  }
  if (!regroup && votes.size > 0) {
    return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }
  if (votes.size > 0) {
    return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }
  return mintGroupId(ids);
}

export function adoptAnalysis(
  doc: Cuts,
  ids: IdState,
  payload: AnalysisPayload,
  options: { regroup?: boolean; initial?: boolean; reset?: boolean } = {},
): { doc: Cuts; retired: string[]; created: string[] } {
  const regroup = Boolean(options.regroup);
  const reset = Boolean(options.reset);
  const scripted =
    payload.pipeline === "scripted" ||
    payload.clips.some((clip) => Boolean(clip.script)) ||
    payload.groups.some((group) => typeof group.scriptLine === "number");
  const scope = payload.scope ?? "full";
  const range =
    scope === "range" && payload.rangeStart != null && payload.rangeEnd != null
      ? { sourceStart: payload.rangeStart, sourceEnd: payload.rangeEnd }
      : null;

  const candidates = doc.clips.filter((clip) =>
    range ? overlaps({ sourceStart: clip.sourceStart, sourceEnd: clip.sourceEnd }, range) : true,
  );
  const keepers = doc.clips.filter((clip) => !candidates.includes(clip));
  const incomingClips = range
    ? payload.clips.filter((clip) => overlaps(outer(clip), range))
    : payload.clips;
  const matched = reset ? new Map<string, Clip>() : greedyMatch(candidates, incomingClips);
  const retired = candidates.filter((clip) => ![...matched.values()].includes(clip)).map((clip) => clip.id);
  const created: string[] = [];

  const clusters = new Map<string, PyClip[]>();
  for (const clip of incomingClips) {
    const list = clusters.get(clip.groupId) ?? [];
    list.push(clip);
    clusters.set(clip.groupId, list);
  }
  const groupOfPy = new Map<string, string>();
  const usedScriptGroups = new Set<string>();
  for (const [pyGroup, members] of clusters) {
    const pyMeta = payload.groups.find((group) => group.id === pyGroup);
    if (typeof pyMeta?.scriptLine === "number" && !reset) {
      const existing = doc.groups.find((group) => group.scriptLine === pyMeta.scriptLine && !usedScriptGroups.has(group.id));
      if (existing) {
        usedScriptGroups.add(existing.id);
        groupOfPy.set(pyGroup, existing.id);
        continue;
      }
    }
    groupOfPy.set(pyGroup, studioGroupForCluster(members, matched, ids, regroup));
  }
  for (const group of payload.groups) {
    if (groupOfPy.has(group.id)) continue;
    if (typeof group.scriptLine === "number" && !reset) {
      const existing = doc.groups.find((item) => item.scriptLine === group.scriptLine && !usedScriptGroups.has(item.id));
      if (existing) {
        usedScriptGroups.add(existing.id);
        groupOfPy.set(group.id, existing.id);
        continue;
      }
    }
    groupOfPy.set(group.id, mintGroupId(ids));
  }

  const nextClips: Clip[] = [...keepers];
  for (const incoming of incomingClips) {
    const score = payload.scores?.[incoming.id];
    const span = outer(incoming);
    const ranges = incoming.ranges?.length ? incoming.ranges : [span];
    const hit = matched.get(incoming.id);
    if (hit && !regroup) {
      hit.sourceStart = span.sourceStart;
      hit.sourceEnd = span.sourceEnd;
      hit.ranges = ranges;
      hit.duration = incoming.duration ?? rangeDuration(ranges);
      hit.text = incoming.text;
      hit.words = incoming.words ?? [];
      hit.label = labelFromPy(incoming);
      hit.score = score?.score ?? hit.score;
      hit.reasons = score?.reasons ?? hit.reasons;
      if (incoming.script) hit.script = incoming.script;
      if (scripted && incoming.status && hit.decidedBy === "algorithm") {
        hit.status = incoming.status;
        hit.decidedBy = incoming.decidedBy ?? "algorithm";
        hit.statusReason = incoming.statusReason ?? hit.statusReason;
        hit.statusAt = new Date().toISOString();
      }
      if (hit.text.length === 0) hit.text = textFromWords(hit.words);
      nextClips.push(hit);
      continue;
    }
    const id = hit?.id ?? mintClipId(ids);
    if (!hit) created.push(id);
    const groupId = regroup ? groupOfPy.get(incoming.groupId)! : hit?.groupId ?? groupOfPy.get(incoming.groupId)!;
    const clip: Clip = {
      id,
      parentIds: hit?.parentIds ?? [],
      sourceStart: span.sourceStart,
      sourceEnd: span.sourceEnd,
      ranges,
      duration: incoming.duration ?? rangeDuration(ranges),
      text: incoming.text || textFromWords(incoming.words ?? []),
      words: incoming.words ?? [],
      groupId,
      label: labelFromPy(incoming),
      score: score?.score ?? 0,
      reasons: score?.reasons ?? [],
      status:
        hit && hit.decidedBy !== "algorithm"
          ? hit.status
          : scripted
            ? (incoming.status ?? "undecided")
            : "undecided",
      decidedBy: hit && hit.decidedBy !== "algorithm" ? hit.decidedBy : (incoming.decidedBy ?? "algorithm"),
      statusReason: hit && hit.decidedBy !== "algorithm" ? hit.statusReason : (incoming.statusReason ?? hit?.statusReason ?? ""),
      statusAt: hit?.statusAt ?? (scripted ? new Date().toISOString() : ""),
      note: hit?.note ?? "",
      llm: hit?.llm ?? {},
      script: incoming.script ?? hit?.script,
    };
    if (regroup && hit) {
      clip.groupId = groupOfPy.get(incoming.groupId)!;
    }
    nextClips.push(clip);
  }

  const referenceByStudio = new Map<string, string>();
  for (const group of payload.groups) {
    const studioGroup = groupOfPy.get(group.id);
    const ref = group.referenceClipId ? matched.get(group.referenceClipId)?.id : undefined;
    const createdRef = payload.clips.find((clip) => clip.id === group.referenceClipId);
    if (studioGroup && (ref || createdRef)) {
      const resolved = ref ?? nextClips.find((clip) => clip.parentIds.length === 0 && clip.text === createdRef?.text)?.id;
      if (resolved && !referenceByStudio.has(studioGroup)) referenceByStudio.set(studioGroup, resolved);
    }
  }

  const groups: Group[] = [];
  const seen = new Set<string>();
  for (const clip of nextClips.sort((a, b) => a.sourceStart - b.sourceStart)) {
    if (seen.has(clip.groupId)) continue;
    seen.add(clip.groupId);
    const members = nextClips.filter((item) => item.groupId === clip.groupId);
    const recommended =
      referenceByStudio.get(clip.groupId) ??
      members.find((item) => item.status === "selected")?.id ??
      members.find((item) => item.reasons.includes("reference take"))?.id ??
      null;
    const labelSource = members.find((item) => item.id === recommended) ?? members[0];
    const pyGroup = payload.groups.find((group) => groupOfPy.get(group.id) === clip.groupId);
    groups.push({
      id: clip.groupId,
      label: pyGroup?.label || labelSource?.text || "",
      clipIds: members.map((item) => item.id),
      recommendedClipId: recommended,
      scriptLine: pyGroup?.scriptLine,
    });
  }
  for (const pyGroup of payload.groups) {
    const studioId = groupOfPy.get(pyGroup.id);
    if (!studioId || seen.has(studioId)) continue;
    seen.add(studioId);
    groups.push({
      id: studioId,
      label: pyGroup.label ?? "",
      clipIds: [],
      recommendedClipId: null,
      scriptLine: pyGroup.scriptLine,
    });
  }
  if (scripted) {
    groups.sort((a, b) => (a.scriptLine ?? 1e9) - (b.scriptLine ?? 1e9));
  }

  const selectedOrder = scripted
    ? groups.flatMap((group) => {
        const selected = nextClips.find((clip) => clip.groupId === group.id && clip.status === "selected");
        return selected ? [selected.id] : [];
      })
    : doc.order.filter((id) => nextClips.some((clip) => clip.id === id && clip.status === "selected"));

  const next: Cuts = {
    ...doc,
    clips: nextClips.sort((a, b) => a.sourceStart - b.sourceStart),
    groups,
    order: selectedOrder,
  };
  if (!scripted && (options.initial || reset)) applyAlgorithmCut(next);
  return { doc: next, retired, created };
}
