import {
  type Actor,
  type Clip,
  type ClipLabel,
  type Cuts,
  type Group,
  type IdState,
  type SourceRange,
  type Word,
  OpError,
  clipById,
  mintClipId,
  mintGroupId,
  playRanges,
  rangeDuration,
  textFromWords,
} from "./types.js";

export type Op =
  | { op: "select"; clipId: string }
  | { op: "reject"; clipId: string }
  | { op: "undecided"; clipId: string }
  | { op: "reorder"; order: string[] }
  | { op: "split"; clipId: string; at?: number; wordIndex?: number; sampleAccurate?: boolean }
  | { op: "merge"; clipIds: [string, string] }
  | {
      op: "trim";
      clipId: string;
      start?: number;
      end?: number;
      sampleAccurate?: boolean;
    }
  | { op: "ungroup"; clipId: string }
  | { op: "moveToGroup"; clipId: string; groupId: string }
  | { op: "note"; clipId: string; note: string };

const ADJACENT_GAP_SECONDS = 1;

function fail(clipId: string | null, field: string, message: string, allowed?: unknown): never {
  throw new OpError([{ clipId, field, message, allowed }]);
}

function syncBounds(clip: Clip, ranges: SourceRange[], words: Word[]): void {
  const ordered = [...ranges].sort((a, b) => a.sourceStart - b.sourceStart);
  clip.ranges = ordered;
  clip.sourceStart = ordered[0]?.sourceStart ?? clip.sourceStart;
  clip.sourceEnd = ordered[ordered.length - 1]?.sourceEnd ?? clip.sourceEnd;
  clip.words = [...words].sort((a, b) => a.start - b.start || a.end - b.end);
  clip.text = textFromWords(clip.words) || clip.text;
  clip.duration = rangeDuration(ordered);
}

function detach(doc: Cuts, clipId: string): void {
  doc.order = doc.order.filter((id) => id !== clipId);
  for (const group of doc.groups) {
    group.clipIds = group.clipIds.filter((id) => id !== clipId);
    if (group.recommendedClipId === clipId) group.recommendedClipId = group.clipIds[0] ?? null;
  }
  doc.groups = doc.groups.filter((group) => group.clipIds.length > 0);
  doc.clips = doc.clips.filter((clip) => clip.id !== clipId);
}

function insertSelected(doc: Cuts, clip: Clip): void {
  if (doc.order.includes(clip.id)) return;
  const index = doc.order.findIndex((id) => {
    const other = doc.clips.find((item) => item.id === id);
    return other != null && other.sourceStart > clip.sourceStart;
  });
  if (index === -1) doc.order.push(clip.id);
  else doc.order.splice(index, 0, clip.id);
}

function setStatus(doc: Cuts, clip: Clip, status: Clip["status"], actor: Actor): void {
  clip.status = status;
  clip.decidedBy = actor;
  if (status === "selected") insertSelected(doc, clip);
  else doc.order = doc.order.filter((id) => id !== clip.id);
}

function replaceInGroup(doc: Cuts, groupId: string, removeIds: string[], add: Clip[]): void {
  let group = doc.groups.find((item) => item.id === groupId);
  if (!group) {
    group = {
      id: groupId,
      label: add[0]?.text ?? "",
      clipIds: [],
      recommendedClipId: add[0]?.id ?? null,
    };
    doc.groups.push(group);
  }
  group.clipIds = group.clipIds.filter((id) => !removeIds.includes(id));
  for (const clip of add) {
    if (!group.clipIds.includes(clip.id)) group.clipIds.push(clip.id);
  }
  group.clipIds.sort((a, b) => {
    const left = doc.clips.find((clip) => clip.id === a) ?? add.find((clip) => clip.id === a);
    const right = doc.clips.find((clip) => clip.id === b) ?? add.find((clip) => clip.id === b);
    return (left?.sourceStart ?? 0) - (right?.sourceStart ?? 0);
  });
}

function childFrom(
  ids: IdState,
  parent: Clip,
  ranges: SourceRange[],
  words: Word[],
  actor: Actor,
): Clip {
  const clip: Clip = {
    ...parent,
    id: mintClipId(ids),
    parentIds: [parent.id],
    words: [],
    ranges: [],
    status: "undecided",
    decidedBy: actor,
    note: parent.note,
    label: "none",
    score: parent.score,
    reasons: [`split from ${parent.id}`],
  };
  syncBounds(clip, ranges, words);
  return clip;
}

function splitAtWords(clip: Clip, wordIndex: number): { left: Word[]; right: Word[] } {
  if (!Number.isInteger(wordIndex)) {
    fail(clip.id, "wordIndex", "wordIndex must be an integer", { min: 1, max: Math.max(0, clip.words.length - 1) });
  }
  if (clip.words.length < 2 || wordIndex <= 0 || wordIndex >= clip.words.length) {
    fail(clip.id, "wordIndex", "wordIndex must leave words on both sides", {
      min: 1,
      max: Math.max(0, clip.words.length - 1),
    });
  }
  return { left: clip.words.slice(0, wordIndex), right: clip.words.slice(wordIndex) };
}

function boundaryForTime(clip: Clip, at: number, sampleAccurate: boolean): number {
  if (at <= clip.sourceStart || at >= clip.sourceEnd) {
    fail(clip.id, "at", "split time must be inside the clip", {
      min: clip.sourceStart,
      max: clip.sourceEnd,
    });
  }
  if (sampleAccurate || clip.words.length === 0) return at;
  const hit = clip.words.find((word) => word.start < at && word.end > at);
  if (hit) return at - hit.start <= hit.end - at ? hit.start : hit.end;
  let best = at;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const word of clip.words) {
    for (const edge of [word.start, word.end]) {
      if (edge <= clip.sourceStart || edge >= clip.sourceEnd) continue;
      const dist = Math.abs(edge - at);
      if (dist < bestDist) {
        bestDist = dist;
        best = edge;
      }
    }
  }
  return best;
}

function applySplit(doc: Cuts, ids: IdState, op: Extract<Op, { op: "split" }>, actor: Actor): string {
  const clip = clipById(doc, op.clipId);
  if (clip.ranges.length > 1) {
    fail(clip.id, "ranges", "Split a single-range clip; trim a stitched clip instead");
  }
  const hasAt = op.at != null;
  const hasWord = op.wordIndex != null;
  if (hasAt === hasWord) fail(clip.id, "at", "Provide exactly one of at or wordIndex");

  let leftWords: Word[];
  let rightWords: Word[];
  let boundary: number;
  if (hasWord) {
    const parts = splitAtWords(clip, op.wordIndex ?? 0);
    leftWords = parts.left;
    rightWords = parts.right;
    boundary = rightWords[0]?.start ?? clip.sourceEnd;
  } else {
    boundary = boundaryForTime(clip, op.at ?? 0, Boolean(op.sampleAccurate));
    leftWords = clip.words.filter((word) => word.end <= boundary + 1e-3);
    rightWords = clip.words.filter((word) => word.start >= boundary - 1e-3);
  }
  if (boundary <= clip.sourceStart || boundary >= clip.sourceEnd) {
    fail(clip.id, "at", "Split would leave an empty side", { min: clip.sourceStart, max: clip.sourceEnd });
  }
  const left = childFrom(
    ids,
    clip,
    [{ sourceStart: clip.sourceStart, sourceEnd: boundary }],
    leftWords,
    actor,
  );
  const right = childFrom(
    ids,
    clip,
    [{ sourceStart: boundary, sourceEnd: clip.sourceEnd }],
    rightWords,
    actor,
  );
  const parentStatus = clip.status;
  const orderIndex = doc.order.indexOf(clip.id);
  detach(doc, clip.id);
  left.status = parentStatus;
  right.status = parentStatus;
  doc.clips.push(left, right);
  replaceInGroup(doc, clip.groupId, [clip.id], [left, right]);
  if (parentStatus === "selected") {
    const index = orderIndex === -1 ? doc.order.length : Math.min(orderIndex, doc.order.length);
    doc.order.splice(index, 0, left.id, right.id);
  }
  return `split ${clip.id} into ${left.id} and ${right.id}`;
}

function applyMerge(doc: Cuts, ids: IdState, clipIds: [string, string], actor: Actor): string {
  const [firstId, secondId] = clipIds;
  if (firstId === secondId) fail(firstId, "clipIds", "Merge needs two different clips");
  const first = clipById(doc, firstId);
  const second = clipById(doc, secondId);
  const [left, right] = first.sourceStart <= second.sourceStart ? [first, second] : [second, first];
  const gap = right.sourceStart - left.sourceEnd;
  if (gap < -0.05) {
    fail(left.id, "clipIds", "Clips overlap and cannot be merged", { gap });
  }
  if (gap > ADJACENT_GAP_SECONDS) {
    fail(left.id, "clipIds", "Clips are not adjacent", { gap, maxGap: ADJACENT_GAP_SECONDS });
  }
  const merged: Clip = {
    ...left,
    id: mintClipId(ids),
    parentIds: [left.id, right.id],
    status: left.status === "selected" || right.status === "selected" ? "selected" : "undecided",
    decidedBy: actor,
    note: [left.note, right.note].filter(Boolean).join("\n"),
    label: left.label !== "none" ? left.label : right.label,
    score: Math.min(left.score, right.score),
    reasons: [`merged ${left.id} and ${right.id}`],
    groupId: left.groupId,
  };
  syncBounds(merged, [...playRanges(left), ...playRanges(right)], [...left.words, ...right.words]);
  const orderIndex = Math.min(
    ...[left, right].map((clip) => doc.order.indexOf(clip.id)).filter((index) => index >= 0),
    doc.order.length,
  );
  detach(doc, left.id);
  detach(doc, right.id);
  doc.clips.push(merged);
  replaceInGroup(doc, left.groupId, [left.id, right.id], [merged]);
  if (merged.status === "selected") {
    doc.order.splice(Math.max(0, orderIndex), 0, merged.id);
  }
  return `merged ${left.id} and ${right.id} into ${merged.id}`;
}

function snapTrim(clip: Clip, start: number, end: number): { start: number; end: number; words: Word[] } {
  if (clip.words.length === 0) {
    fail(clip.id, "words", "This clip has no words to snap to; pass sampleAccurate", {
      min: clip.sourceStart,
      max: clip.sourceEnd,
    });
  }
  let snappedStart = start;
  const hitStart = clip.words.find((word) => word.start < start && word.end > start);
  if (hitStart) snappedStart = hitStart.start;
  else {
    const next = clip.words.find((word) => word.start >= start - 1e-3);
    if (!next) {
      fail(clip.id, "start", "start is after the last word", { min: clip.sourceStart, max: clip.sourceEnd });
    }
    snappedStart = next.start;
  }
  let snappedEnd = end;
  const hitEnd = [...clip.words].reverse().find((word) => word.start < end && word.end > end);
  if (hitEnd) snappedEnd = hitEnd.end;
  else {
    const prev = [...clip.words].reverse().find((word) => word.end <= end + 1e-3);
    if (!prev) {
      fail(clip.id, "end", "end is before the first word", { min: clip.sourceStart, max: clip.sourceEnd });
    }
    snappedEnd = prev.end;
  }
  if (snappedEnd <= snappedStart) {
    fail(clip.id, "end", "trim snapped to an empty span", { start: snappedStart, end: snappedEnd });
  }
  const words = clip.words.filter((word) => word.start >= snappedStart - 1e-3 && word.end <= snappedEnd + 1e-3);
  return { start: snappedStart, end: snappedEnd, words };
}

function applyTrim(doc: Cuts, op: Extract<Op, { op: "trim" }>, actor: Actor): string {
  const clip = clipById(doc, op.clipId);
  if (op.start == null && op.end == null) fail(clip.id, "start", "Provide start or end");
  let start = op.start ?? clip.sourceStart;
  let end = op.end ?? clip.sourceEnd;
  if (start < clip.sourceStart - 1e-3 || end > clip.sourceEnd + 1e-3) {
    fail(clip.id, op.start != null && start < clip.sourceStart ? "start" : "end", "trim must stay inside the clip", {
      min: clip.sourceStart,
      max: clip.sourceEnd,
    });
  }
  start = Math.max(clip.sourceStart, start);
  end = Math.min(clip.sourceEnd, end);
  if (end - start <= 0.01) {
    fail(clip.id, "end", "trim must leave a positive duration", { min: clip.sourceStart, max: clip.sourceEnd });
  }
  const words = op.sampleAccurate
    ? clip.words.filter((word) => word.end > start && word.start < end)
    : snapTrim(clip, start, end).words;
  if (!op.sampleAccurate) {
    const snapped = snapTrim(clip, start, end);
    start = snapped.start;
    end = snapped.end;
  }
  const nextRanges = playRanges(clip)
    .map((range) => ({
      sourceStart: Math.max(range.sourceStart, start),
      sourceEnd: Math.min(range.sourceEnd, end),
    }))
    .filter((range) => range.sourceEnd - range.sourceStart > 0.01);
  if (nextRanges.length === 0) fail(clip.id, "start", "trim removed every range");
  syncBounds(clip, nextRanges, words);
  clip.decidedBy = actor;
  clip.reasons = [...clip.reasons.filter((reason) => !reason.startsWith("trimmed")), "trimmed"];
  return `trimmed ${clip.id}`;
}

function applyOne(doc: Cuts, ids: IdState, op: Op, actor: Actor): string {
  switch (op.op) {
    case "select":
    case "reject":
    case "undecided": {
      const clip = clipById(doc, op.clipId);
      setStatus(doc, clip, op.op === "select" ? "selected" : op.op === "reject" ? "rejected" : "undecided", actor);
      return `${op.op} ${clip.id}`;
    }
    case "reorder": {
      const selected = doc.clips.filter((clip) => clip.status === "selected").map((clip) => clip.id);
      const same =
        op.order.length === selected.length && op.order.every((id) => selected.includes(id));
      if (!same) {
        fail(null, "order", "order must list each selected clip once", selected);
      }
      doc.order = [...op.order];
      return "reordered cut";
    }
    case "note": {
      const clip = clipById(doc, op.clipId);
      if (op.note.length > 4000) fail(clip.id, "note", "note is longer than 4000 characters", { max: 4000 });
      clip.note = op.note;
      return `noted ${clip.id}`;
    }
    case "ungroup": {
      const clip = clipById(doc, op.clipId);
      const nextGroup = mintGroupId(ids);
      for (const group of doc.groups) {
        group.clipIds = group.clipIds.filter((id) => id !== clip.id);
        if (group.recommendedClipId === clip.id) group.recommendedClipId = group.clipIds[0] ?? null;
      }
      doc.groups = doc.groups.filter((group) => group.clipIds.length > 0);
      clip.groupId = nextGroup;
      doc.groups.push({
        id: nextGroup,
        label: clip.text,
        clipIds: [clip.id],
        recommendedClipId: clip.id,
      });
      return `ungrouped ${clip.id} into ${nextGroup}`;
    }
    case "moveToGroup": {
      const clip = clipById(doc, op.clipId);
      const target = doc.groups.find((group) => group.id === op.groupId);
      if (!target) {
        fail(clip.id, "groupId", `Unknown group ${op.groupId}`, doc.groups.map((group) => group.id));
      }
      if (clip.groupId === target.id) return `kept ${clip.id} in ${target.id}`;
      for (const group of doc.groups) {
        if (group.id === clip.groupId) {
          group.clipIds = group.clipIds.filter((id) => id !== clip.id);
          if (group.recommendedClipId === clip.id) group.recommendedClipId = group.clipIds[0] ?? null;
        }
      }
      doc.groups = doc.groups.filter((group) => group.clipIds.length > 0);
      clip.groupId = target.id;
      if (!target.clipIds.includes(clip.id)) target.clipIds.push(clip.id);
      return `moved ${clip.id} to ${target.id}`;
    }
    case "split":
      return applySplit(doc, ids, op, actor);
    case "merge":
      return applyMerge(doc, ids, op.clipIds, actor);
    case "trim":
      return applyTrim(doc, op, actor);
    default:
      fail(null, "op", "Unknown operation");
  }
}

export function applyOps(doc: Cuts, ids: IdState, ops: Op[], actor: Actor): { doc: Cuts; summary: string } {
  if (ops.length === 0) fail(null, "ops", "Provide at least one operation");
  const next = structuredClone(doc);
  const idState: IdState = { nextClipSeq: ids.nextClipSeq, nextGroupSeq: ids.nextGroupSeq };
  const parts: string[] = [];
  for (const op of ops) parts.push(applyOne(next, idState, op, actor));
  ids.nextClipSeq = idState.nextClipSeq;
  ids.nextGroupSeq = idState.nextGroupSeq;
  return { doc: next, summary: parts.join("; ") };
}

export function applyAlgorithmCut(doc: Cuts): void {
  const byStart = (group: Group) => {
    const times = group.clipIds.map((id) => doc.clips.find((clip) => clip.id === id)?.sourceStart ?? 0);
    return Math.min(...times);
  };
  const groups = [...doc.groups].sort((a, b) => byStart(a) - byStart(b));
  const order: string[] = [];
  for (const group of groups) {
    const members = group.clipIds
      .map((id) => doc.clips.find((clip) => clip.id === id))
      .filter((clip): clip is Clip => clip != null);
    const recommended =
      members.find((clip) => clip.reasons.includes("reference take")) ??
      members.find((clip) => clip.id === group.recommendedClipId) ??
      members.find((clip) => clip.label !== "falseStart") ??
      members[0];
    for (const clip of members) {
      if (recommended && clip.id === recommended.id) {
        clip.status = "selected";
        order.push(clip.id);
      } else if (clip.label !== "none") {
        clip.status = "rejected";
      } else {
        clip.status = "undecided";
      }
      clip.decidedBy = "algorithm";
    }
  }
  doc.order = order;
}

export function weakestLabel(labels: ClipLabel[]): ClipLabel {
  return labels.find((label) => label !== "none") ?? "none";
}
