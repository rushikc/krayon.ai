import { describe, expect, it } from "vitest";

import {
  clipMatchesFilter,
  cycleStatusFilter,
  statusDotTone,
  takeLabelFromId,
  takeNumberFromId,
} from "@/lib/studio-clip";

describe("studio clip helpers", () => {
  it("reads take numbers from clip ids", () => {
    expect(takeNumberFromId("c-0007")).toBe(7);
    expect(takeLabelFromId("c-0007")).toBe("Take 7");
  });

  it("maps selected to accepted and everything else to not accepted", () => {
    expect(statusDotTone("selected")).toBe("accepted");
    expect(statusDotTone("rejected")).toBe("notAccepted");
    expect(statusDotTone("undecided")).toBe("notAccepted");
  });

  it("cycles the accepted / not accepted filter", () => {
    expect(cycleStatusFilter("all")).toBe("accepted");
    expect(cycleStatusFilter("accepted")).toBe("notAccepted");
    expect(cycleStatusFilter("notAccepted")).toBe("all");
    expect(clipMatchesFilter({ status: "selected" }, "accepted")).toBe(true);
    expect(clipMatchesFilter({ status: "undecided" }, "accepted")).toBe(false);
    expect(clipMatchesFilter({ status: "rejected" }, "notAccepted")).toBe(true);
  });
});
