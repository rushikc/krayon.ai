import { describe, expect, it } from "vitest";

import { clipHasIssue, clipIssueLabel, studioClipIssueLabel } from "@/lib/delivery-issue";
import type { ClipItem } from "@/types/api";

function clip(overrides: Partial<ClipItem> = {}): ClipItem {
  return {
    id: "c1",
    index: 0,
    sourceStart: 0,
    sourceEnd: 1,
    duration: 1,
    text: "hello",
    groupId: "g1",
    ...overrides,
  };
}

describe("clipIssueLabel", () => {
  it("prefers false start over a delivery issue", () => {
    expect(clipIssueLabel(clip({ falseStart: true, deliveryIssue: "cut_off" }))).toBe("False start");
  });

  it("labels each delivery issue", () => {
    expect(clipIssueLabel(clip({ deliveryIssue: "cut_off" }))).toBe("Cut off");
    expect(clipIssueLabel(clip({ deliveryIssue: "starts_late" }))).toBe("Starts late");
    expect(clipIssueLabel(clip({ deliveryIssue: "missing_words" }))).toBe("Missing words");
    expect(clipIssueLabel(clip({ deliveryIssue: "misstatement" }))).toBe("Misstatement");
  });

  it("treats a clean clip as having no issue", () => {
    expect(clipIssueLabel(clip())).toBeNull();
    expect(clipHasIssue(clip())).toBe(false);
    expect(clipHasIssue(clip({ deliveryIssue: "cut_off" }))).toBe(true);
  });
});

describe("studioClipIssueLabel", () => {
  it("maps studio labels and ignores none", () => {
    expect(studioClipIssueLabel("none")).toBeNull();
    expect(studioClipIssueLabel(null)).toBeNull();
    expect(studioClipIssueLabel("falseStart")).toBe("False start");
    expect(studioClipIssueLabel("missing_words")).toBe("Missing words");
    expect(studioClipIssueLabel("cut_off")).toBe("Cut off");
  });
});
