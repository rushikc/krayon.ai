import { describe, expect, it } from "vitest";
import { adoptAnalysis } from "../src/domain/adopt.js";
import { lintCuts } from "../src/domain/lint.js";
import { applyAlgorithmCut, applyOps } from "../src/domain/ops.js";
import { studioSchema } from "../src/domain/schema.js";
import {
  type Clip,
  type Cuts,
  type IdState,
  emptyCuts,
  mintClipId,
  mintGroupId,
  OpError,
} from "../src/domain/types.js";

function ids(): IdState {
  return { nextClipSeq: 1, nextGroupSeq: 1 };
}

function makeClip(partial: Partial<Clip> & Pick<Clip, "id" | "sourceStart" | "sourceEnd" | "text" | "groupId">): Clip {
  return {
    parentIds: [],
    ranges: [{ sourceStart: partial.sourceStart, sourceEnd: partial.sourceEnd }],
    duration: partial.sourceEnd - partial.sourceStart,
    words: partial.words ?? [
      { text: partial.text, start: partial.sourceStart + 0.05, end: partial.sourceEnd - 0.05 },
    ],
    label: "none",
    score: 1,
    reasons: [],
    status: "undecided",
    decidedBy: "algorithm",
    note: "",
    ...partial,
  };
}

describe("clip ids", () => {
  it("mints stable short ids and never reuses them after split and merge", () => {
    const state = ids();
    const doc = emptyCuts();
    const groupId = mintGroupId(state);
    const first = makeClip({
      id: mintClipId(state),
      groupId,
      sourceStart: 0,
      sourceEnd: 2,
      text: "one two",
      words: [
        { text: "one", start: 0.1, end: 0.4 },
        { text: "two", start: 0.5, end: 0.9 },
      ],
    });
    const second = makeClip({
      id: mintClipId(state),
      groupId,
      sourceStart: 2.2,
      sourceEnd: 3,
      text: "three",
      status: "selected",
    });
    doc.clips = [first, second];
    doc.groups = [{ id: groupId, label: "one two", clipIds: [first.id, second.id], recommendedClipId: first.id }];
    doc.order = [second.id];

    const split = applyOps(doc, state, [{ op: "split", clipId: first.id, wordIndex: 1 }], "human");
    expect(split.doc.clips.map((clip) => clip.id)).not.toContain(first.id);
    expect(split.doc.clips.find((clip) => clip.text === "one")?.parentIds).toEqual([first.id]);
    expect(split.doc.clips.find((clip) => clip.id === second.id)?.id).toBe(second.id);

    const left = split.doc.clips.find((clip) => clip.text === "one")!;
    const right = split.doc.clips.find((clip) => clip.text === "two")!;
    const merged = applyOps(split.doc, state, [{ op: "merge", clipIds: [left.id, right.id] }], "grok");
    const baby = merged.doc.clips.find((clip) => clip.parentIds.includes(left.id));
    expect(baby?.id).not.toBe(first.id);
    expect(baby?.id).not.toBe(left.id);
    expect(merged.doc.clips.map((clip) => clip.id)).toContain(second.id);
    expect(state.nextClipSeq).toBeGreaterThan(4);
  });

  it("keeps ids when reanalysis overlaps and mints ids for new spans", () => {
    const state = { nextClipSeq: 3, nextGroupSeq: 2 };
    const doc = emptyCuts();
    doc.clips = [
      makeClip({ id: "c-0001", groupId: "g-0001", sourceStart: 0, sourceEnd: 2, text: "hello there", note: "keep me", decidedBy: "human", status: "selected" }),
      makeClip({ id: "c-0002", groupId: "g-0001", sourceStart: 10, sourceEnd: 12, text: "later" }),
    ];
    doc.groups = [{ id: "g-0001", label: "hello", clipIds: ["c-0001", "c-0002"], recommendedClipId: "c-0001" }];
    doc.order = ["c-0001"];
    const adopted = adoptAnalysis(doc, state, {
      scope: "full",
      clips: [
        { id: "tmp-a", sourceStart: 0.05, sourceEnd: 1.95, text: "hello there", groupId: "py-1", words: [{ text: "hello", start: 0.1, end: 0.4 }] },
        { id: "tmp-b", sourceStart: 10, sourceEnd: 12, text: "later", groupId: "py-1" },
        { id: "tmp-c", sourceStart: 20, sourceEnd: 21, text: "brand new", groupId: "py-2" },
      ],
      groups: [{ id: "py-1", clipIds: ["tmp-a", "tmp-b"], referenceClipId: "tmp-a" }, { id: "py-2", clipIds: ["tmp-c"] }],
      scores: { "tmp-a": { score: 4, reasons: ["reference take"] } },
    });
    const idsKept = adopted.doc.clips.map((clip) => clip.id);
    expect(idsKept).toContain("c-0001");
    expect(idsKept).toContain("c-0002");
    expect(idsKept).not.toContain("tmp-c");
    expect(adopted.created).toHaveLength(1);
    expect(adopted.doc.clips.find((clip) => clip.id === "c-0001")?.note).toBe("keep me");
    expect(adopted.doc.clips.find((clip) => clip.id === "c-0001")?.status).toBe("selected");
  });
});

describe("ops", () => {
  it("rejects an atomic batch without changing the document", () => {
    const state = { nextClipSeq: 2, nextGroupSeq: 2 };
    const doc: Cuts = emptyCuts();
    doc.clips = [makeClip({ id: "c-0001", groupId: "g-0001", sourceStart: 0, sourceEnd: 1, text: "only", status: "undecided" })];
    doc.groups = [{ id: "g-0001", label: "only", clipIds: ["c-0001"], recommendedClipId: "c-0001" }];
    const before = structuredClone(doc);
    expect(() =>
      applyOps(
        doc,
        state,
        [
          { op: "select", clipId: "c-0001" },
          { op: "split", clipId: "c-0001", wordIndex: 5 },
        ],
        "human",
      ),
    ).toThrow(OpError);
    expect(doc).toEqual(before);
    try {
      applyOps(doc, state, [{ op: "split", clipId: "c-0001", wordIndex: 5 }], "human");
    } catch (error) {
      expect(error).toBeInstanceOf(OpError);
      const op = error as OpError;
      expect(op.errors[0]?.clipId).toBe("c-0001");
      expect(op.errors[0]?.field).toBe("wordIndex");
      expect(op.errors[0]?.allowed).toEqual({ min: 1, max: 0 });
    }
  });

  it("snaps trim to word boundaries unless sample accurate", () => {
    const state = ids();
    const doc = emptyCuts();
    doc.clips = [
      makeClip({
        id: "c-0001",
        groupId: "g-0001",
        sourceStart: 0,
        sourceEnd: 2,
        text: "alpha beta",
        words: [
          { text: "alpha", start: 0.2, end: 0.6 },
          { text: "beta", start: 0.8, end: 1.4 },
        ],
      }),
    ];
    doc.groups = [{ id: "g-0001", label: "alpha beta", clipIds: ["c-0001"], recommendedClipId: null }];
    const snapped = applyOps(doc, state, [{ op: "trim", clipId: "c-0001", start: 0.4, end: 0.7 }], "human");
    const clip = snapped.doc.clips[0]!;
    expect(clip.sourceStart).toBeCloseTo(0.2);
    expect(clip.sourceEnd).toBeCloseTo(0.6);
    expect(clip.words.map((word) => word.text)).toEqual(["alpha"]);

    const exact = applyOps(doc, state, [{ op: "trim", clipId: "c-0001", start: 0.3, end: 1.0, sampleAccurate: true }], "grok");
    expect(exact.doc.clips[0]?.sourceStart).toBeCloseTo(0.3);
  });

  it("selects the reference take and orders groups by first appearance", () => {
    const doc = emptyCuts();
    doc.clips = [
      makeClip({ id: "c-0002", groupId: "g-0002", sourceStart: 5, sourceEnd: 6, text: "second line", reasons: ["reference take"] }),
      makeClip({ id: "c-0003", groupId: "g-0002", sourceStart: 8, sourceEnd: 9, text: "sec", label: "cut_off" }),
      makeClip({ id: "c-0001", groupId: "g-0001", sourceStart: 0, sourceEnd: 1, text: "first", reasons: ["only take in group"] }),
    ];
    doc.groups = [
      { id: "g-0002", label: "second line", clipIds: ["c-0002", "c-0003"], recommendedClipId: "c-0002" },
      { id: "g-0001", label: "first", clipIds: ["c-0001"], recommendedClipId: "c-0001" },
    ];
    applyAlgorithmCut(doc);
    expect(doc.order).toEqual(["c-0001", "c-0002"]);
    expect(doc.clips.find((clip) => clip.id === "c-0003")?.status).toBe("rejected");
    expect(doc.clips.find((clip) => clip.id === "c-0002")?.status).toBe("selected");
  });
});

describe("lint and schema", () => {
  it("warns about weak selected takes and empty groups", () => {
    const doc = emptyCuts();
    doc.clips = [
      makeClip({ id: "c-0001", groupId: "g-0001", sourceStart: 0, sourceEnd: 0.2, text: "no", status: "selected", label: "falseStart" }),
    ];
    doc.groups = [
      { id: "g-0001", label: "no", clipIds: ["c-0001"], recommendedClipId: "c-0001" },
      { id: "g-0002", label: "missing", clipIds: [], recommendedClipId: null },
    ];
    doc.order = ["c-0001"];
    const codes = lintCuts(doc).map((warning) => warning.code);
    expect(codes).toContain("short_clip");
    expect(codes).toContain("selected_weak");
  });

  it("describes ops and the conflict example", () => {
    expect(studioSchema.ops.length).toBeGreaterThan(5);
    expect(studioSchema.exampleError.error).toBe("validation");
    expect(studioSchema.clip.id).toContain("c-0007");
  });
});
