import { describe, expect, it } from "vitest";

import {
  isPreviewAudioFile,
  isPreviewAudioScrub,
  shouldSeekPreviewAudio,
} from "@/lib/preview-audio";

describe("isPreviewAudioFile", () => {
  it("accepts wav and mp3 by extension", () => {
    expect(isPreviewAudioFile(new File([], "voice.wav"))).toBe(true);
    expect(isPreviewAudioFile(new File([], "VOICE.MP3"))).toBe(true);
  });

  it("accepts wav and mp3 by mime type", () => {
    expect(
      isPreviewAudioFile(new File([], "clip", { type: "audio/wav" })),
    ).toBe(true);
    expect(
      isPreviewAudioFile(new File([], "clip", { type: "audio/mpeg" })),
    ).toBe(true);
  });

  it("rejects other audio files", () => {
    expect(isPreviewAudioFile(new File([], "song.m4a"))).toBe(false);
    expect(
      isPreviewAudioFile(new File([], "song", { type: "audio/aac" })),
    ).toBe(false);
  });
});

describe("shouldSeekPreviewAudio", () => {
  it("keeps the media clock when drift is within 0.2s", () => {
    expect(shouldSeekPreviewAudio(1, 1.1)).toBe(false);
    expect(shouldSeekPreviewAudio(1, 1.2)).toBe(false);
  });

  it("seeks when drift is over 0.2s", () => {
    expect(shouldSeekPreviewAudio(1, 1.21)).toBe(true);
    expect(shouldSeekPreviewAudio(4, 3.5)).toBe(true);
  });
});

describe("isPreviewAudioScrub", () => {
  it("treats a 16ms clock tick as playback, not a scrub", () => {
    expect(isPreviewAudioScrub(1, 1.016)).toBe(false);
  });

  it("treats a 0.5s skip as a scrub", () => {
    expect(isPreviewAudioScrub(1, 1.5)).toBe(true);
  });
});
