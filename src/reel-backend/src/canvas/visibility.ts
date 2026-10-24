import type { CanvasElement } from "./types.js";

export function isElementActiveAt(time: { start: number; end: number }, t: number): boolean {
  return t >= time.start && t < time.end;
}

export const REEL_CLOCK_FPS = 30;

export function durationFromElements(elements: CanvasElement[]): number {
  let maxEnd = 0;
  for (const element of elements) {
    maxEnd = Math.max(maxEnd, element.time.end, element.time.start);
  }
  return Math.max(1, maxEnd);
}

export function lastVisibleTime(duration: number, fps = REEL_CLOCK_FPS): number {
  const safe = Math.max(duration, 0);
  if (safe <= 0) return 0;
  return Math.max(0, safe - 1 / fps);
}

export function collectKeyframeTimes(elements: CanvasElement[], maxFrames: number): number[] {
  const duration = durationFromElements(elements);
  const last = lastVisibleTime(duration);
  const candidates: number[] = [last];
  for (const element of elements) {
    candidates.push(element.time.start);
    const mid = (element.time.start + Math.min(element.time.end, duration)) / 2;
    if (mid >= 0) candidates.push(mid);
  }
  const unique = [...new Set(candidates.map((t) => Math.round(t * 1000) / 1000))]
    .filter((t) => t >= 0 && t <= last)
    .sort((a, b) => a - b);
  if (unique.length <= maxFrames) return unique;
  if (maxFrames <= 1) return [last];
  const first = unique[0] ?? 0;
  const inner = unique.slice(1, -1);
  const keep = maxFrames - 2;
  const picked: number[] = [first];
  if (keep > 0 && inner.length > 0) {
    for (let i = 0; i < keep; i += 1) {
      const idx = Math.round(((i + 1) / (keep + 1)) * (inner.length - 1));
      const value = inner[idx];
      if (value != null) picked.push(value);
    }
  }
  picked.push(last);
  return [...new Set(picked)].sort((a, b) => a - b);
}
