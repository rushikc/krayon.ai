import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClipItem } from "@/types/api";
import { useMediaStore } from "@/stores/media-store";

vi.mock("@/lib/api/client", () => ({
  getEditorState: vi.fn(async () => null),
  setActiveEditorVersion: vi.fn(),
}));

const clip = {
  id: "c1",
  index: 0,
  sourceStart: 0,
  sourceEnd: 1,
  duration: 1,
  text: "hello",
  groupId: "g1",
  words: [],
  falseStart: false,
  deliveryIssue: null,
  ranges: [{ sourceStart: 0, sourceEnd: 1 }],
} as ClipItem;

describe("media store", () => {
  beforeEach(() => {
    useMediaStore.setState({
      folderPath: null,
      files: [],
      selectedId: null,
      clips: [],
      clipGroups: [],
      selectedClipId: null,
      selectedEntry: null,
      error: null,
    });
  });

  it("stores a folder, clips, and the selected speech clip", () => {
    useMediaStore.getState().setFolder("/tmp/videos", [
      { id: "m1", name: "talk.mp4", path: "/tmp/videos/talk.mp4", duration: 4, size: 10 },
    ]);
    expect(useMediaStore.getState().files).toHaveLength(1);
    useMediaStore.getState().setSelected("m1");
    useMediaStore.getState().setClips([clip], [{ id: "g1", label: "hello", clipIds: ["c1"], referenceClipId: "c1" }]);
    useMediaStore.getState().selectSpeechClip("c1");
    expect(useMediaStore.getState().selectedClipId).toBe("c1");
    expect(useMediaStore.getState().selectedEntry).toEqual({ kind: "speech", clipId: "c1" });
    useMediaStore.getState().setError("unreadable");
    expect(useMediaStore.getState().error).toBe("unreadable");
  });
});
