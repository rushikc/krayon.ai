import { describe, expect, it } from "vitest";
import { lintCuts, type AudioEdgeStats } from "../src/domain/lint.js";
import type { Clip, Cuts, Group } from "../src/domain/types.js";
import { clip } from "./helpers.js";

function doc(clips: Clip[], extra: Partial<Cuts> = {}): Cuts {
  const groups = new Map<string, Clip[]>();
  for (const item of clips) {
    const list = groups.get(item.groupId) ?? [];
    list.push(item);
    groups.set(item.groupId, list);
  }
  const built: Group[] = [...groups.entries()].map(([id, members]) => ({
    id,
    label: members[0]?.text ?? id,
    clipIds: members.map((item) => item.id),
    recommendedClipId: members[0]?.id ?? null,
  }));
  return {
    revision: 1,
    clips,
    groups: extra.groups ?? built,
    order: extra.order ?? clips.filter((item) => item.status === "selected").map((item) => item.id),
    canvasDraft: { version: 1, elements: [] },
  };
}

function edge(rms: number): AudioEdgeStats {
  const levels = { rmsDbfs: rms, peakDbfs: rms };
  return { start: levels, end: levels, before: levels, after: levels, startEdge: levels, endEdge: levels };
}

function codes(warnings: { code: string }[]) {
  return warnings.map((warning) => warning.code);
}

describe("lint thresholds", () => {
  it("fires short_clip under 0.35s and not at 0.35s", () => {
    const under = doc([clip({ id: "c-0001", text: "a", sourceStart: 0, sourceEnd: 0.34, duration: 0.34 })]);
    const at = doc([clip({ id: "c-0001", text: "a", sourceStart: 0, sourceEnd: 0.35, duration: 0.35 })]);
    expect(codes(lintCuts(under))).toContain("short_clip");
    expect(codes(lintCuts(at))).not.toContain("short_clip");
  });

  it("fires selected_weak only when a labelled clip is selected", () => {
    const weak = doc([clip({ id: "c-0001", text: "a", status: "selected", label: "cut_off" })]);
    const clean = doc([clip({ id: "c-0001", text: "a", status: "selected", label: "none" })]);
    expect(codes(lintCuts(weak))).toContain("selected_weak");
    expect(codes(lintCuts(clean))).not.toContain("selected_weak");
  });

  it("fires mid_word inside a word and not on the 0.02s margin", () => {
    const inside = doc([
      clip({
        id: "c-0001",
        text: "alpha",
        sourceStart: 0.5,
        sourceEnd: 2,
        words: [{ text: "alpha", start: 0.2, end: 1.2 }],
      }),
    ]);
    const edgeWord = doc([
      clip({
        id: "c-0001",
        text: "alpha",
        sourceStart: 0.22,
        sourceEnd: 2,
        words: [{ text: "alpha", start: 0.2, end: 1.2 }],
      }),
    ]);
    expect(codes(lintCuts(inside))).toContain("mid_word");
    expect(codes(lintCuts(edgeWord))).not.toContain("mid_word");
  });

  it("fires bad_word_timing outside 0.02s and 1s", () => {
    const tiny = doc([
      clip({
        id: "c-0001",
        text: "a",
        words: [{ text: "a", start: 0.2, end: 0.219 }],
      }),
    ]);
    const ok = doc([
      clip({
        id: "c-0001",
        text: "a",
        words: [{ text: "a", start: 0.2, end: 0.25 }],
      }),
    ]);
    const huge = doc([
      clip({
        id: "c-0001",
        text: "a",
        words: [{ text: "a", start: 0.2, end: 1.21 }],
      }),
    ]);
    const atMax = doc([
      clip({
        id: "c-0001",
        text: "a",
        words: [{ text: "a", start: 0.2, end: 1.2 }],
      }),
    ]);
    expect(codes(lintCuts(tiny))).toContain("bad_word_timing");
    expect(codes(lintCuts(ok))).not.toContain("bad_word_timing");
    expect(codes(lintCuts(huge))).toContain("bad_word_timing");
    expect(codes(lintCuts(atMax))).not.toContain("bad_word_timing");
  });

  it("fires edge_loud above -40 dBFS and edge_clipped above -30 dBFS", () => {
    const quiet = doc([clip({ id: "c-0001", text: "a", status: "selected" })]);
    const loud = doc([clip({ id: "c-0001", text: "a", status: "selected" })]);
    const clipped = doc([clip({ id: "c-0001", text: "a", status: "selected" })]);
    expect(codes(lintCuts(quiet, { "c-0001": edge(-40) }))).not.toContain("edge_loud");
    expect(codes(lintCuts(loud, { "c-0001": edge(-39.9) }))).toContain("edge_loud");
    const atClip = edge(-40);
    atClip.startEdge = { rmsDbfs: -30, peakDbfs: -30 };
    atClip.before = { rmsDbfs: -39, peakDbfs: -39 };
    expect(codes(lintCuts(clipped, { "c-0001": atClip }))).not.toContain("edge_clipped");
    const over = edge(-39);
    over.startEdge = { rmsDbfs: -29.9, peakDbfs: -29.9 };
    expect(codes(lintCuts(clipped, { "c-0001": over }))).toContain("edge_clipped");
  });

  it("fires group, gap, and overlap rules on the far side of each threshold", () => {
    const missing = doc([], {
      groups: [{ id: "g-0001", label: "line", clipIds: [], recommendedClipId: null, scriptLine: 2 }],
      order: [],
    });
    expect(codes(lintCuts(missing))).toContain("script_line_missing");

    const unselected = doc([clip({ id: "c-0001", text: "a", status: "undecided" })]);
    expect(codes(lintCuts(unselected))).toContain("group_unselected");

    const duplicate = doc([
      clip({ id: "c-0001", text: "a", status: "selected" }),
      clip({ id: "c-0002", text: "a", sourceStart: 3, sourceEnd: 5, status: "selected" }),
    ]);
    expect(codes(lintCuts(duplicate))).toContain("duplicate_line");

    const gap = doc([
      clip({ id: "c-0001", text: "a", sourceStart: 0, sourceEnd: 1, status: "selected" }),
      clip({ id: "c-0002", text: "b", sourceStart: 3.01, sourceEnd: 4, status: "selected", groupId: "g-0002" }),
    ]);
    const touching = doc([
      clip({ id: "c-0001", text: "a", sourceStart: 0, sourceEnd: 1, status: "selected" }),
      clip({ id: "c-0002", text: "b", sourceStart: 3, sourceEnd: 4, status: "selected", groupId: "g-0002" }),
    ]);
    expect(codes(lintCuts(gap))).toContain("gap");
    expect(codes(lintCuts(touching))).not.toContain("gap");

    const overlap = doc([
      clip({ id: "c-0001", text: "a", sourceStart: 0, sourceEnd: 2, status: "selected" }),
      clip({ id: "c-0002", text: "b", sourceStart: 1.94, sourceEnd: 3, status: "selected", groupId: "g-0002" }),
    ]);
    const clear = doc([
      clip({ id: "c-0001", text: "a", sourceStart: 0, sourceEnd: 2, status: "selected" }),
      clip({ id: "c-0002", text: "b", sourceStart: 1.95, sourceEnd: 3, status: "selected", groupId: "g-0002" }),
    ]);
    expect(codes(lintCuts(overlap))).toContain("overlap");
    expect(codes(lintCuts(clear))).not.toContain("overlap");
  });

  it.fails("BUG: lintCuts does not warn when the selected order is empty", () => {
    const empty = doc([clip({ id: "c-0001", text: "a", status: "selected" })], { order: [] });
    expect(codes(lintCuts(empty)).some((code) => code.includes("order") || code === "empty_order")).toBe(true);
  });
});
