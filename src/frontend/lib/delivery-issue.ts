import type { ClipItem, DeliveryIssue } from "@/types/api";

const DELIVERY_ISSUE_LABELS: Record<DeliveryIssue, string> = {
  cut_off: "Cut off",
  starts_late: "Starts late",
  missing_words: "Missing words",
  misstatement: "Misstatement",
};

export function clipIssueLabel(clip: ClipItem | null | undefined): string | null {
  if (!clip) return null;
  if (clip.falseStart) return "False start";
  if (!clip.deliveryIssue) return null;
  return DELIVERY_ISSUE_LABELS[clip.deliveryIssue] ?? null;
}

export function clipHasIssue(clip: ClipItem | null | undefined): boolean {
  return clipIssueLabel(clip) != null;
}

export function studioClipIssueLabel(label: string | null | undefined): string | null {
  if (!label || label === "none") return null;
  if (label === "falseStart") return "False start";
  return DELIVERY_ISSUE_LABELS[label as DeliveryIssue] ?? label;
}
