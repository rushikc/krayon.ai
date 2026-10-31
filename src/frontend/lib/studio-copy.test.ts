import { describe, expect, it } from "vitest";

import { describeClips, describeIds } from "@/lib/studio-copy";

describe("studio copy payload", () => {
  it("copies ids and a compact grok description", () => {
    expect(describeIds(["c-0007", "c-0008"])).toBe("c-0007 c-0008");
    expect(
      describeClips([
        { id: "c-0007", sourceStart: 12.2, sourceEnd: 18.04, text: "the best take" },
      ]),
    ).toBe("c-0007 12.20-18.04s the best take");
  });
});
