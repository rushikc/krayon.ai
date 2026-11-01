import { beforeEach, describe, expect, it } from "vitest";
import { useSilenceStore } from "@/stores/silence-store";

describe("silence store", () => {
  beforeEach(() => {
    useSilenceStore.setState({
      phase: "idle",
      progress: 0,
      message: null,
      error: null,
      transcript: "",
      transcriptOpen: false,
      clipCount: 0,
    });
  });

  it("patches options and job progress", () => {
    useSilenceStore.getState().setOptions({ silenceThreshold: 0.2 });
    expect(useSilenceStore.getState().options.silenceThreshold).toBe(0.2);
    useSilenceStore.getState().setSimilarityThreshold(0.55);
    expect(useSilenceStore.getState().similarityThreshold).toBe(0.55);
    useSilenceStore.getState().setJobState({ phase: "running", progress: 0.4, message: "Transcribing", error: null });
    expect(useSilenceStore.getState().phase).toBe("running");
    expect(useSilenceStore.getState().message).toBe("Transcribing");
    useSilenceStore.setState({ transcript: "alpha beta" });
    useSilenceStore.getState().setTranscriptOpen(true);
    expect(useSilenceStore.getState().transcriptOpen).toBe(true);
    expect(useSilenceStore.getState().transcript).toBe("alpha beta");
  });
});
