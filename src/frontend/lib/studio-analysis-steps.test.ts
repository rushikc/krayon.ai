import { describe, expect, it } from "vitest";

import { applyStudioPhase, initialStudioSteps, studioStepDefs } from "@/lib/studio-analysis-steps";

describe("studio analysis steps", () => {
  it("maps transcript and scripted labels and optional snap", () => {
    const transcript = studioStepDefs("transcript", true).map((step) => step.label);
    expect(transcript).toEqual([
      "Extract audio",
      "Transcribe",
      "Cut by silence",
      "Group retakes",
      "Snap cuts to the waveform",
      "Save clips",
    ]);
    const scripted = studioStepDefs("scripted", false).map((step) => step.label);
    expect(scripted).toEqual(["Extract audio", "Transcribe", "Align to script", "Match script lines to takes", "Save clips"]);
  });

  it("marks earlier phases done when applying a later phase", () => {
    const steps = initialStudioSteps("transcript", true);
    const next = applyStudioPhase(steps, "segmenting", 0.2, "Building speech segments…");
    expect(next.find((step) => step.id === "extracting")?.status).toBe("done");
    expect(next.find((step) => step.id === "transcribing")?.status).toBe("done");
    expect(next.find((step) => step.id === "segmenting")?.status).toBe("active");
    expect(next.find((step) => step.id === "grouping")?.status).toBe("pending");
  });

  it("marks extract and transcribe done for rebuild from a cached transcript", () => {
    const steps = initialStudioSteps("transcript", true, "resegment", true);
    expect(steps[0]?.status).toBe("done");
    expect(steps[1]?.status).toBe("done");
    expect(steps[1]?.message).toMatch(/cached transcript/i);
  });
});
