import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClipsSidebar } from "@/components/layout/ClipsSidebar";
import { LibrarySidebar } from "@/components/layout/LibrarySidebar";
import { TranscriptPanel } from "@/components/layout/TranscriptPanel";
import { ClipAudioPlayer } from "@/components/player/ClipAudioPlayer";
import { PipelineStepper } from "@/components/player/PipelineStepper";
import { useMediaStore } from "@/stores/media-store";
import { useSilenceStore } from "@/stores/silence-store";
import type { ClipItem } from "@/types/api";

vi.mock("@/lib/api/client", () => ({
  getEditorState: vi.fn(async () => null),
  setActiveEditorVersion: vi.fn(),
  clipAudioUrl: () => "/clip.wav",
}));

const clip = {
  id: "c1",
  index: 0,
  sourceStart: 0,
  sourceEnd: 1.2,
  duration: 1.2,
  text: "hello from the take",
  groupId: "g1",
  words: [{ text: "hello", start: 0.1, end: 0.4 }],
  falseStart: false,
  deliveryIssue: null,
  ranges: [{ sourceStart: 0, sourceEnd: 1.2 }],
} as ClipItem;

describe("legacy editor surfaces", () => {
  beforeEach(() => {
    useMediaStore.setState({
      folderPath: "/tmp/videos",
      files: [{ id: "m1", name: "talk.mp4", path: "/tmp/videos/talk.mp4", size: 20, duration: 4 }],
      selectedId: "m1",
      clips: [clip],
      clipGroups: [{ id: "g1", label: "hello from the take", clipIds: ["c1"], referenceClipId: "c1" }],
      selectedClipId: "c1",
      selectedEntry: { kind: "speech", clipId: "c1" },
      error: null,
    });
    useSilenceStore.setState({
      transcript: "hello from the take",
      transcriptOpen: true,
      clipCount: 1,
      phase: "done",
      message: "Grouped takes",
      error: null,
    });
  });

  it("renders the library, clips, player, stepper, and transcript", () => {
    const onOpenFolder = vi.fn();
    render(<LibrarySidebar onOpenFolder={onOpenFolder} />);
    expect(screen.getByText("talk.mp4")).toBeInTheDocument();
    render(<ClipsSidebar />);
    expect(screen.getAllByText(/hello from the take/).length).toBeGreaterThan(0);
    render(<ClipAudioPlayer />);
    render(<PipelineStepper />);
    expect(screen.getByRole("heading", { name: "Analyzing silence" })).toBeInTheDocument();
    expect(screen.getByText("Grouped takes")).toBeInTheDocument();
    render(<TranscriptPanel />);
    expect(screen.getAllByText(/hello/).length).toBeGreaterThan(0);
  });
});
