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
