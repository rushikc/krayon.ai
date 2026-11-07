import { describe, expect, it } from "vitest";

import { mediaStreamUrl } from "@/lib/api/client";
import { formatDuration, formatElapsedHuman, formatResolution, formatSize } from "@/lib/format";
import { buildTimeline, isTimelineEntrySelected } from "@/lib/timeline";
import type { ClipItem } from "@/types/api";

const clip = (id: string, start: number, end: number): ClipItem => ({
  id,
  index: 0,
  path: null,
  sourceStart: start,
  sourceEnd: end,
  duration: end - start,
  text: id,
  groupId: "g",
  words: [],
});

describe("audio editor timeline", () => {
  it("inserts silence gaps between speech clips", () => {
    const entries = buildTimeline(10, [clip("a", 1, 3), clip("b", 6, 8)]);
    expect(entries.map((entry) => [entry.kind, entry.start, entry.end])).toEqual([
      ["silence", 0, 1],
      ["speech", 1, 3],
      ["silence", 3, 6],
      ["speech", 6, 8],
      ["silence", 8, 10],
    ]);
  });

  it("skips tiny gaps under 50ms", () => {
    const entries = buildTimeline(5, [clip("a", 0, 2), clip("b", 2.02, 4)]);
    expect(entries.filter((entry) => entry.kind === "silence")).toHaveLength(1);
    expect(entries[entries.length - 1]).toMatchObject({ kind: "silence", start: 4, end: 5 });
  });

  it("matches selected speech and silence entries", () => {
    const entries = buildTimeline(10, [clip("a", 1, 3)]);
    const speech = entries.find((entry) => entry.kind === "speech")!;
    const silence = entries.find((entry) => entry.kind === "silence")!;
    expect(isTimelineEntrySelected(speech, { kind: "speech", clipId: "a" })).toBe(true);
    expect(isTimelineEntrySelected(speech, { kind: "speech", clipId: "other" })).toBe(false);
    expect(
      isTimelineEntrySelected(silence, {
        kind: "silence",
        start: silence.start,
        end: silence.end,
      }),
    ).toBe(true);
  });
});

describe("formatting and media urls", () => {
  it("formats durations, sizes, and resolutions", () => {
    expect(formatDuration(75)).toBe("1:15");
    expect(formatDuration(0)).toBe("—");
    expect(formatElapsedHuman(160)).toBe("2 min 40 s");
    expect(formatElapsedHuman(2.3)).toBe("2.3 s");
    expect(formatElapsedHuman(2)).toBe("2 s");
    expect(formatElapsedHuman(18 * 60)).toBe("18 min");
    expect(formatElapsedHuman(3720)).toBe("1 h 2 min");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatResolution(1080, 1920)).toBe("1080×1920");
  });

  it("builds stream urls from media ids", () => {
    expect(mediaStreamUrl("abc")).toBe("/api/media/stream/abc");
  });
});
