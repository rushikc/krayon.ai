import { describe, expect, it } from "vitest";

import { describeClips, describeIds, describeOpsPreview, studioCopy } from "@/lib/studio-copy";

describe("studio copy payload", () => {
  it("copies ids and a compact grok description", () => {
    expect(describeIds(["c-0007", "c-0008"])).toBe("c-0007 c-0008");
    expect(
      describeClips([
        { id: "c-0007", sourceStart: 12.2, sourceEnd: 18.04, text: "the best take" },
      ]),
    ).toBe("c-0007 12.20-18.04s the best take");
    expect(describeOpsPreview([{ op: "reject", clipId: "c-0003" }, { op: "select", clipId: "c-0007" }])).toBe(
      "reject c-0003, select c-0007",
    );
    expect(studioCopy.staleResult).toContain("re-propose");
    expect(studioCopy.pendingBadge(2)).toBe("2 pending asks");
  });
});
