import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StudioSettings } from "@/lib/api/studio-client";
import { studioCopy } from "@/lib/studio-copy";
import { StudioControlsPanel } from "@/pages/studio/StudioControlsPanel";

vi.mock("@/lib/api/client", () => ({
  getToolsStatus: vi.fn(async () => ({ ffmpeg: true, ffprobe: true, whisperReady: true, whisperModel: "base" })),
}));

const settings: StudioSettings = {
  silenceThreshold: 0.4,
  pad: 0.05,
  similarityThreshold: 0.7,
  snapToAudio: true,
  snapSearchSeconds: 0.3,
};

function renderPanel(extra: Partial<Parameters<typeof StudioControlsPanel>[0]> = {}) {
  return render(
    <StudioControlsPanel
      asks={[]}
      highlightAsk={null}
      busyAsk={null}
      onAnswer={vi.fn()}
      onSelectClip={vi.fn()}
      onDismissAsk={vi.fn()}
      settings={settings}
      onSaveSettings={vi.fn()}
      selectedCount={1}
      selectedClock="0:01"
      warnings={[]}
      onSelectWarning={vi.fn()}
      renderBusy={false}
      renderProgress={null}
      onRender={vi.fn()}
      onCancelRender={vi.fn()}
      renders={[]}
      onPlayRender={vi.fn()}
      onLoadTranscript={vi.fn(async () => ({ words: [] }))}
      clipCount={2}
      hasTranscript
      hasSource
      analysisBusy={false}
      onAnalyze={vi.fn()}
      onRebuild={vi.fn()}
      script="alpha\nbeta"
      onSaveScript={vi.fn()}
      scriptLineCount={2}
      matchedLines={1}
      missingLines={1}
      {...extra}
    />,
  );
}

describe("StudioControlsPanel", () => {
  it("keeps settings closed and validates number bounds", () => {
    renderPanel();
    const box = screen.getByTestId("settings-box");
    expect(box).not.toHaveAttribute("open");
    box.setAttribute("open", "");
    const silence = screen.getByRole("spinbutton", { name: studioCopy.silenceThreshold });
    expect(silence).toHaveAttribute("min", "0.1");
    expect(silence).toHaveAttribute("max", "2");
    expect(screen.getByRole("button", { name: studioCopy.analyzeAudio })).toBeEnabled();
  });

  it("disables analyze without a video and shows busy progress", () => {
    const onAnalyze = vi.fn();
    renderPanel({
      hasSource: false,
      analysisBusy: true,
      analysisMessage: "Segmenting",
      analysisDurationSeconds: 120,
      onAnalyze,
      renderProgress: { message: "Rendering", ratio: 0.4 },
      needsRebuild: true,
    });
    expect(screen.getByRole("button", { name: studioCopy.analyzeAudio })).toBeDisabled();
    expect(screen.getByText("Segmenting")).toBeInTheDocument();
    expect(screen.queryByTestId("analysis-duration")).not.toBeInTheDocument();
    expect(screen.getByTestId("needs-rebuild")).toHaveTextContent(studioCopy.needsRebuild);
    expect(screen.getByTestId("render-progress")).toHaveTextContent("Rendering");
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it("shows the last analysis duration above the analyze controls", () => {
    renderPanel({ analysisDurationSeconds: 160 });
    expect(screen.getByTestId("analysis-duration")).toHaveTextContent("Last analysis took 2 min 40 s");
    expect(screen.queryByTestId("analysis-timings")).not.toBeInTheDocument();
  });

  it("renders a per-stage timing breakdown", () => {
    renderPanel({
      analysisDurationSeconds: 1140,
      analysisTimings: {
        startedAt: "2026-11-07T14:00:00.000Z",
        finishedAt: "2026-11-07T14:19:00.000Z",
        totalSeconds: 1140,
        pipeline: "transcript",
        status: "ready",
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
            finishedAt: "2026-11-07T14:18:08.000Z",
            seconds: 1080,
            status: "done",
            message: "Transcribed",
          },
          {
            id: "segmenting",
            label: "Cut by silence",
            startedAt: "2026-11-07T14:18:08.000Z",
            finishedAt: "2026-11-07T14:18:08.000Z",
            seconds: 0,
            status: "skipped",
            message: "Reusing cached transcript",
          },
          {
            id: "grouping",
            label: "Group retakes",
            startedAt: "2026-11-07T14:18:08.000Z",
            finishedAt: "2026-11-07T14:18:10.000Z",
            seconds: 2,
            status: "error",
            message: "failed",
          },
        ],
      },
    });
    const breakdown = screen.getByTestId("analysis-timings");
    expect(breakdown).toHaveTextContent("Extract audio");
    expect(breakdown).toHaveTextContent("8 s");
    expect(breakdown).toHaveTextContent("Transcribe");
    expect(breakdown).toHaveTextContent("18 min");
    expect(breakdown).toHaveTextContent("skipped 0 s");
    expect(breakdown.querySelector(".text-destructive")).not.toBeNull();
  });

  it("rebuilds with or without the script and cancel leaves the callback alone", async () => {
    const onRebuild = vi.fn();
    renderPanel({ onRebuild });
    await userEvent.click(screen.getByRole("button", { name: studioCopy.rebuild }));
    expect(screen.getByTestId("rebuild-with-script")).toBeInTheDocument();
    expect(screen.getByTestId("rebuild-without-script")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: studioCopy.cancel }));
    expect(onRebuild).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: studioCopy.rebuild }));
    await userEvent.click(screen.getByTestId("rebuild-without-script"));
    expect(onRebuild).toHaveBeenCalledWith("transcript");
  });

  it("saves language from the settings select and shows a forced-English warning", async () => {
    const onSaveSettings = vi.fn();
    renderPanel({
      onSaveSettings,
      detectedLanguage: "hi",
      settings: { ...settings, language: "en" },
    });
    screen.getByTestId("settings-box").setAttribute("open", "");
    const select = screen.getByTestId("settings-language") as HTMLSelectElement;
    expect(select.value).toBe("en");
    expect(screen.getByTestId("language-warning")).toHaveTextContent(/Auto/);
    await userEvent.selectOptions(select, "hi");
    expect(onSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ language: "hi" }));
  });

  it("saves grouping mode from the settings radios", async () => {
    const onSaveSettings = vi.fn();
    renderPanel({ onSaveSettings });
    screen.getByTestId("settings-box").setAttribute("open", "");
    await userEvent.click(screen.getByRole("radio", { name: "Group similar takes anywhere" }));
    expect(onSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ groupingMode: "global" }));
  });

  it("disables analyze and rebuild while analysis is running", () => {
    renderPanel({ analysisBusy: true, hasTranscript: true, hasSource: true });
    expect(screen.getByRole("button", { name: studioCopy.analyzeAudio })).toBeDisabled();
    expect(screen.getByRole("button", { name: studioCopy.rebuild })).toBeDisabled();
  });

  it.fails("BUG: settings panel has no snapToAudio toggle", () => {
    renderPanel();
    screen.getByTestId("settings-box").setAttribute("open", "");
    expect(screen.getByRole("checkbox", { name: /snap/i })).toBeInTheDocument();
  });
});
