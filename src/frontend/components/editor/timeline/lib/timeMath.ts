import { clamp } from "@/components/editor/timeline/lib/clamp";

export { clamp };

export const MIN_SEGMENT_DURATION = 0.5;
export const TIMELINE_TIME_STEP_SECONDS = 0.1;
export const TRACK_ROW_HEIGHT = 44;
export const TIMELINE_RULER_HEIGHT = 28;
export const VISIBLE_TRACK_ROWS = 5;
export const DEFAULT_TIMELINE_HEIGHT =
  TIMELINE_RULER_HEIGHT + VISIBLE_TRACK_ROWS * TRACK_ROW_HEIGHT;

export interface RulerTick {
  time: number;
  major: boolean;
}

export function formatRulerLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function timeToPercent(time: number, safeDuration: number): string {
  if (safeDuration <= 0) {
    return "0%";
  }
  return `${clamp(time / safeDuration, 0, 1) * 100}%`;
}

export function segmentWidthPercent(
  start: number,
  end: number,
  safeDuration: number,
): string {
  if (safeDuration <= 0) {
    return "0%";
  }
  const clippedStart = clamp(start, 0, safeDuration);
  const clippedEnd = clamp(end, 0, safeDuration);
  return `${(Math.max(0, clippedEnd - clippedStart) / safeDuration) * 100}%`;
}

export function roundTime(time: number): number {
  return Math.round(time / TIMELINE_TIME_STEP_SECONDS) * TIMELINE_TIME_STEP_SECONDS;
}

export function pixelToTime(
  clientX: number,
  scrollLeft: number,
  containerLeft: number,
  timelineWidth: number,
  safeDuration: number,
): number {
  if (timelineWidth <= 0) {
    return 0;
  }
  const x = clientX - containerLeft + scrollLeft;
  return clamp(x / timelineWidth, 0, 1) * safeDuration;
}

export function computeSegmentTimingAfterDrag(
  segment: { start: number; end: number },
  deltaX: number,
  pxPerSecond: number,
  safeDuration: number,
): { start: number; end: number } {
  const duration = segment.end - segment.start;
  const start = clamp(
    segment.start + deltaX / pxPerSecond,
    0,
    Math.max(0, safeDuration - duration),
  );
  const end = start + duration;
  return { start, end };
}

export function getSegmentResizeBounds(
  segment: { start: number; end: number },
  others: { start: number; end: number }[],
  safeDuration: number,
): { minStart: number; maxEnd: number } {
  let minStart = 0;
  let maxEnd = safeDuration;

  for (const other of others) {
    if (other.end <= segment.start) {
      minStart = Math.max(minStart, other.end);
    }
    if (other.start >= segment.end) {
      maxEnd = Math.min(maxEnd, other.start);
    }
  }

  return { minStart, maxEnd };
}

export function computeSegmentTimingAfterResize(
  original: { start: number; end: number },
  edge: "left" | "right",
  deltaX: number,
  pxPerSecond: number,
  safeDuration: number,
  others: { start: number; end: number }[],
  minDuration: number = MIN_SEGMENT_DURATION,
): { start: number; end: number } {
  const deltaTime = deltaX / pxPerSecond;
  const { minStart, maxEnd } = getSegmentResizeBounds(
    original,
    others,
    safeDuration,
  );

  if (edge === "left") {
    const maxStart = original.end - minDuration;
    const start = clamp(original.start + deltaTime, minStart, maxStart);
    return { start: roundTime(start), end: original.end };
  }

  const minEnd = original.start + minDuration;
  const end = clamp(original.end + deltaTime, minEnd, maxEnd);
  return { start: original.start, end: roundTime(end) };
}

export function canResizeSegmentTo(
  proposed: { start: number; end: number },
  others: { start: number; end: number }[],
  safeDuration: number,
  minDuration: number = MIN_SEGMENT_DURATION,
): boolean {
  if (proposed.end - proposed.start < minDuration) {
    return false;
  }

  return canPlaceSegment(proposed.start, proposed.end, others, safeDuration);
}

export function segmentsOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

export function findOverlappingSegment<T extends { start: number; end: number }>(
  proposed: { start: number; end: number },
  others: T[],
): T | undefined {
  return others.find((other) => segmentsOverlap(proposed, other));
}

export function canPlaceSegment(
  start: number,
  end: number,
  others: { start: number; end: number }[],
  safeDuration: number,
): boolean {
  if (start < 0 || end > safeDuration || end - start < MIN_SEGMENT_DURATION) {
    return false;
  }

  return !others.some((other) => segmentsOverlap({ start, end }, other));
}

function snapAdjacentToBlocker(
  blocker: { start: number; end: number },
  duration: number,
  side: "before" | "after",
): { start: number; end: number } {
  if (side === "before") {
    const end = blocker.start;
    return { start: end - duration, end };
  }

  const start = blocker.end;
  return { start, end: start + duration };
}

export function isBetweenTwoPillsWithInsufficientGap(
  proposed: { start: number; end: number },
  duration: number,
  others: { start: number; end: number }[],
): boolean {
  if (others.length < 2) {
    return false;
  }

  const sorted = [...others].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sorted.length - 1; i++) {
    const pillA = sorted[i];
    const pillB = sorted[i + 1];
    const gapStart = pillA.end;
    const gapEnd = pillB.start;
    const gapSize = gapEnd - gapStart;

    if (gapSize >= duration) {
      continue;
    }

    const targetsGap = proposed.start < gapEnd && proposed.end > gapStart;
    if (targetsGap) {
      return true;
    }
  }

  return false;
}

function trySnapSingleBlocker(
  proposed: { start: number; end: number },
  blocker: { start: number; end: number },
  duration: number,
  others: { start: number; end: number }[],
  safeDuration: number,
): { start: number; end: number } | null {
  const side = proposed.start < blocker.start ? "before" : "after";
  const candidate = snapAdjacentToBlocker(blocker, duration, side);

  if (canPlaceSegment(candidate.start, candidate.end, others, safeDuration)) {
    return candidate;
  }

  return null;
}

export function resolveSegmentDrop(
  original: { start: number; end: number },
  proposed: { start: number; end: number },
  others: { start: number; end: number }[],
  safeDuration: number,
): { start: number; end: number } {
  const duration = original.end - original.start;

  if (canPlaceSegment(proposed.start, proposed.end, others, safeDuration)) {
    return proposed;
  }

  if (isBetweenTwoPillsWithInsufficientGap(proposed, duration, others)) {
    return original;
  }

  const blocker = findOverlappingSegment(proposed, others);
  if (blocker) {
    const snapped = trySnapSingleBlocker(
      proposed,
      blocker,
      duration,
      others,
      safeDuration,
    );
    if (snapped) {
      return snapped;
    }
  }

  return original;
}

export function wouldRejectSegmentDrop(
  original: { start: number; end: number },
  proposed: { start: number; end: number },
  others: { start: number; end: number }[],
  safeDuration: number,
): boolean {
  const moved = proposed.start !== original.start || proposed.end !== original.end;
  if (!moved) {
    return false;
  }

  const resolved = resolveSegmentDrop(original, proposed, others, safeDuration);
  return resolved.start === original.start && resolved.end === original.end;
}

export function buildRulerTicks(safeDuration: number): RulerTick[] {
  const majorEvery = safeDuration > 90 ? 10 : 5;
  const minorEvery = majorEvery / 2;
  const ticks: RulerTick[] = [];

  for (let t = 0; t <= safeDuration + minorEvery; t += minorEvery) {
    ticks.push({ time: t, major: t % majorEvery === 0 });
  }

  return ticks;
}

export function clampElementTime(
  start: number,
  end: number,
  duration: number,
): { start: number; end: number } {
  let nextStart = roundTime(clamp(start, 0, duration));
  let nextEnd = roundTime(clamp(end, 0, duration));

  if (nextEnd - nextStart < MIN_SEGMENT_DURATION) {
    nextEnd = clamp(nextStart + MIN_SEGMENT_DURATION, 0, duration);
    nextStart = clamp(nextEnd - MIN_SEGMENT_DURATION, 0, duration);
  }

  return { start: nextStart, end: nextEnd };
}
