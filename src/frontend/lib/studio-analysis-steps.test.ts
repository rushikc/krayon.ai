import { describe, expect, it } from "vitest";

import { applyStudioPhase, applyTimingsToSteps, initialStudioSteps, studioStepDefs } from "@/lib/studio-analysis-steps";

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

  it("copies completed stage seconds from analysisTimings without resetting them", () => {
    const steps = applyStudioPhase(initialStudioSteps("transcript", true), "transcribing", 0.4, "Transcribing…");
    const next = applyTimingsToSteps(steps, {
      startedAt: "2026-11-07T14:00:00.000Z",
      finishedAt: null,
      totalSeconds: 8,
      pipeline: "transcript",
      status: "running",
      stages: [
        {
          id: "extracting",
          label: "Extract audio",
          startedAt: "2026-11-07T14:00:00.000Z",
          finishedAt: "2026-11-07T14:00:08.000Z",
          seconds: 8,
          status: "done",
          message: "Extracted audio",
        },
        {
          id: "transcribing",
          label: "Transcribe",
          startedAt: "2026-11-07T14:00:08.000Z",
          finishedAt: null,
          seconds: 2.1,
          status: "running",
          message: "Transcribing…",
        },
      ],
    });
    expect(next.find((step) => step.id === "extracting")?.seconds).toBe(8);
    expect(next.find((step) => step.id === "transcribing")?.startedAt).toBe("2026-11-07T14:00:08.000Z");
    expect(next.find((step) => step.id === "transcribing")?.stageStatus).toBe("running");
  });
});
