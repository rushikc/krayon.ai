import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StagedProgress } from "@/components/pipeline/StagedProgress";

const steps = [
  { id: "a", label: "Extract audio", status: "done" as const, stepProgress: 1, message: null },
  { id: "b", label: "Transcribe", status: "active" as const, stepProgress: 0.4, message: "Transcribing…" },
  { id: "c", label: "Save clips", status: "pending" as const, stepProgress: 0, message: null },
];

describe("StagedProgress", () => {
  it("renders done, active, and pending steps", () => {
    render(
      <StagedProgress title="Analyzing silence" message="Working" progress={0.4} steps={steps} startedAt={Date.now()} />,
    );
    expect(screen.getByText("Analyzing silence")).toBeInTheDocument();
    expect(screen.getByText("Extract audio")).toBeInTheDocument();
    expect(screen.getAllByText("40%").length).toBeGreaterThan(0);
    expect(screen.getByText("Transcribing…")).toBeInTheDocument();
  });

  it("shows completed and skipped stage durations", () => {
    render(
      <StagedProgress
        title="Analyzing"
        message="Working"
        progress={0.5}
        steps={[
          {
            id: "a",
            label: "Extract audio",
            status: "done",
            stepProgress: 1,
            message: null,
            seconds: 8,
            stageStatus: "done",
          },
          {
            id: "b",
            label: "Transcribe",
            status: "done",
            stepProgress: 1,
            message: "Reusing cached transcript",
            seconds: 0,
            stageStatus: "skipped",
          },
          { id: "c", label: "Save clips", status: "pending", stepProgress: 0, message: null },
        ]}
      />,
    );
    expect(screen.getByText("8 s")).toBeInTheDocument();
    expect(screen.getByText("skipped 0 s")).toBeInTheDocument();
  });

  it("renders an error step and message", () => {
    render(
      <StagedProgress
        title="Analyzing"
        message="Failed"
        progress={0.2}
        error="no transcript"
        steps={[{ id: "a", label: "Extract audio", status: "error", stepProgress: 0.2, message: "no transcript" }]}
      />,
    );
    expect(screen.getByText("no transcript")).toBeInTheDocument();
  });
});
