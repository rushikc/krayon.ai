import type { StudioClip } from "@/lib/api/studio-client";

export type ClipStatusFilter = "all" | "accepted" | "notAccepted";

export function takeNumberFromId(id: string): number {
  const match = /c-(\d+)/i.exec(id);
  return match ? Number(match[1]) : 0;
}

export function takeLabelFromId(id: string): string {
  return `Take ${takeNumberFromId(id)}`;
}

export function isAccepted(clip: Pick<StudioClip, "status">): boolean {
  return clip.status === "selected";
}

export function isNotAccepted(clip: Pick<StudioClip, "status">): boolean {
  return clip.status !== "selected";
}

export function cycleStatusFilter(current: ClipStatusFilter): ClipStatusFilter {
  if (current === "all") return "accepted";
  if (current === "accepted") return "notAccepted";
  return "all";
}

export function clipMatchesFilter(clip: Pick<StudioClip, "status">, filter: ClipStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "accepted") return isAccepted(clip);
  return isNotAccepted(clip);
}

export function statusDotTone(status: StudioClip["status"]): "accepted" | "notAccepted" {
  return status === "selected" ? "accepted" : "notAccepted";
}

export function statusWord(status: StudioClip["status"]): "Accepted" | "Rejected" | "Undecided" {
  if (status === "selected") return "Accepted";
  if (status === "rejected") return "Rejected";
  return "Undecided";
}

export const SPLIT_MIN_GAP = 0.15;

export function wavOrigin(sourceStart: number, pad: number): number {
  return Math.max(0, sourceStart - pad);
}

export function playheadToSource(playhead: number, sourceStart: number, pad: number): number {
  return wavOrigin(sourceStart, pad) + playhead;
}

export function sourceToPlayhead(sourceTime: number, sourceStart: number, pad: number): number {
  return sourceTime - wavOrigin(sourceStart, pad);
}

export function validateCut(at: number, sourceStart: number, sourceEnd: number, existing: number[]): string | null {
  if (at - sourceStart < SPLIT_MIN_GAP || sourceEnd - at < SPLIT_MIN_GAP) {
    return "Cut is too close to the clip start or end";
  }
  if (existing.some((cut) => Math.abs(cut - at) < SPLIT_MIN_GAP)) {
    return "Cut is too close to another cut";
  }
  return null;
}
