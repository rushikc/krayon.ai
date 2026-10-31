import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StudioClip, StudioProject } from "@/lib/api/studio-client";

const applyOps = vi.fn();
const analyze = vi.fn();
const reanalyze = vi.fn();
const getClipPeaks = vi.fn();
const getProject = vi.fn();
const lintProject = vi.fn();
const listConfirmations = vi.fn();
const listOutputs = vi.fn();
const listSegments = vi.fn();
const getTranscript = vi.fn();
const renderStatus = vi.fn();
const startRender = vi.fn();
const listeners: Array<(event: MessageEvent) => void> = [];

vi.mock("@/lib/api/studio-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/studio-client")>("@/lib/api/studio-client");
  return {
    ...actual,
    applyOps: (...args: unknown[]) => applyOps(...args),
    analyze: (...args: unknown[]) => analyze(...args),
    reanalyze: (...args: unknown[]) => reanalyze(...args),
    getClipPeaks: (...args: unknown[]) => getClipPeaks(...args),
    getProject: (...args: unknown[]) => getProject(...args),
    lintProject: (...args: unknown[]) => lintProject(...args),
    listConfirmations: (...args: unknown[]) => listConfirmations(...args),
    listOutputs: (...args: unknown[]) => listOutputs(...args),
    listSegments: (...args: unknown[]) => listSegments(...args),
    getTranscript: (...args: unknown[]) => getTranscript(...args),
    renderStatus: (...args: unknown[]) => renderStatus(...args),
    startRender: (...args: unknown[]) => startRender(...args),
    eventsUrl: () => "/events",
    audioUrl: () => "/audio.wav",
    outputUrl: (_slug: string, name: string) => `/output/${name}`,
    sourceUrl: () => "/source",
  };
});

vi.mock("@/lib/api/client", () => ({
  getToolsStatus: vi.fn(async () => ({ ffmpeg: true, ffprobe: true, whisperReady: true, whisperModel: "base" })),
}));

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor() {
    listeners.push((event) => this.onmessage?.(event));
  }
  close() {}
}

vi.stubGlobal("EventSource", FakeEventSource);

function clip(partial: Partial<StudioClip> & Pick<StudioClip, "id" | "status">): StudioClip {
  return {
    parentIds: [],
    sourceStart: 0,
    sourceEnd: 1,
    ranges: [{ sourceStart: 0, sourceEnd: 1 }],
    duration: 1,
    text: "hello world",
    words: [{ text: "hello", start: 0.1, end: 0.4 }],
    groupId: "g-0001",
    label: "none",
    score: 1,
    reasons: [],
    decidedBy: "algorithm",
    statusReason: "",
    statusAt: "",
    note: "",
    llm: {},
    ...partial,
  };
}

function project(clips: StudioClip[]): StudioProject {
  return {
    meta: {
      slug: "real",
      title: "Real",
      sourcePath: "/tmp/talk.mp4",
      revision: 1,
      status: "ready",
      statusMessage: "ready",
      settings: { silenceThreshold: 0.4, pad: 0.05, similarityThreshold: 0.7 },
    },
    revision: 1,
    status: "ready",
    hasTranscript: true,
    clips,
    groups: [{ id: "g-0001", label: "Have you ever tried to manage", clipIds: clips.map((item) => item.id), recommendedClipId: clips[0]?.id ?? null }],
    order: clips.filter((item) => item.status === "selected").map((item) => item.id),
    history: [],
  };
}

function emit(data: unknown) {
  for (const listener of listeners) listener({ data: JSON.stringify(data) } as MessageEvent);
}

describe("StudioWorkspace", () => {
  beforeEach(() => {
    listeners.length = 0;
    applyOps.mockReset().mockResolvedValue({ revision: 2, summary: "split c-0007 into 3 clips" });
    analyze.mockReset().mockResolvedValue({ revision: 2, clipCount: 3 });
    reanalyze.mockReset().mockResolvedValue({ revision: 3 });
    getClipPeaks.mockReset().mockResolvedValue({ duration: 4, peaks: Array.from({ length: 16 }, () => 0.2) });
    lintProject.mockResolvedValue({ warnings: [] });
    listConfirmations.mockResolvedValue({ items: [] });
    listOutputs.mockResolvedValue({ manifests: [] });
    listSegments.mockResolvedValue({ segments: [] });
    getTranscript.mockResolvedValue({ words: [] });
    renderStatus.mockResolvedValue({ status: "done", ratio: 1, message: "done" });
    startRender.mockResolvedValue({ renderId: "preview-1", outputName: "preview-1.mp4" });
  });

  it("renders clip rows with green and red status dots and filters them", async () => {
    const clips = [
      clip({ id: "c-0001", status: "selected", text: "accepted take" }),
      clip({ id: "c-0002", status: "rejected", text: "rejected take" }),
      clip({ id: "c-0003", status: "undecided", text: "undecided take" }),
    ];
    getProject.mockResolvedValue(project(clips));
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await screen.findByText("Take 1");
    const dots = screen.getAllByTestId("status-dot");
    expect(dots.map((dot) => dot.getAttribute("data-tone"))).toEqual(["accepted", "not-accepted", "not-accepted"]);
    expect(screen.getByLabelText("Accepted")).toBeTruthy();
    expect(screen.getAllByLabelText("Not accepted").length).toBe(2);
    expect(screen.getByTestId("clip-summary")).toHaveTextContent("1 accepted");
    expect(screen.getByTestId("clip-summary")).toHaveTextContent("2 not accepted");
    expect(screen.getByTestId("settings-box")).not.toHaveAttribute("open");

    const summary = screen.getByTestId("clip-summary");
    await userEvent.click(summary.querySelector("button") as HTMLButtonElement);
    expect(screen.queryByText("rejected take")).toBeNull();
    expect(screen.getByText("accepted take")).toBeTruthy();
    await userEvent.click(summary.querySelector("button") as HTMLButtonElement);
    expect(screen.queryByText("accepted take")).toBeNull();
    expect(screen.getByText("rejected take")).toBeTruthy();
    expect(screen.getByText("undecided take")).toBeTruthy();
    await userEvent.click(summary.querySelectorAll("button")[1] as HTMLButtonElement);
    expect(screen.getByText("accepted take")).toBeTruthy();
    expect(screen.getByText("rejected take")).toBeTruthy();
  });

  it("updates a dot from a mocked SSE revision and opens the middle panel", async () => {
    const clips = [clip({ id: "c-0007", status: "undecided", text: "open me" })];
    getProject.mockResolvedValue(project(clips));
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await screen.findByText("Take 7");
    expect(screen.getByTestId("status-dot").getAttribute("data-tone")).toBe("not-accepted");
    await userEvent.click(screen.getByText("open me"));
    expect(screen.getByTestId("clip-data")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();

    getProject.mockResolvedValue(project([clip({ id: "c-0007", status: "selected", text: "open me" })]));
    emit({ type: "revision", revision: 2 });
    await waitFor(() => expect(screen.getByTestId("status-dot").getAttribute("data-tone")).toBe("accepted"));
  });

  it("sends accept and reject ops and keeps all clips when segments open", async () => {
    const clips = [clip({ id: "c-0007", status: "undecided", text: "open me" })];
    getProject.mockResolvedValue(project(clips));
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByText("open me"));
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(applyOps).toHaveBeenCalledWith("real", 1, [{ op: "select", clipId: "c-0007" }], "select");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(applyOps).toHaveBeenCalledWith("real", 1, [{ op: "reject", clipId: "c-0007" }], "reject");
    await userEvent.click(screen.getByRole("button", { name: "Show all segments" }));
    expect(screen.getAllByText("Take 7").length).toBeGreaterThan(0);
    expect(screen.getByTestId("studio-clips")).toHaveTextContent("Take 7");
  });

  it("updates render progress from SSE and switches to the rendered video tab", async () => {
    getProject.mockResolvedValue(project([clip({ id: "c-0001", status: "selected", text: "keep" })]));
    listOutputs.mockResolvedValue({
      manifests: [{ name: "preview-1.mp4", quality: "preview", duration: 2, size: 1000, createdAt: new Date().toISOString() }],
    });
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await screen.findByText("Take 1");
    emit({ type: "render", renderId: "preview-1", phase: "rendering", ratio: 0.4, message: "Rendering…" });
    await waitFor(() => expect(screen.getByTestId("render-progress")).toHaveTextContent("40%"));
    emit({ type: "render", renderId: "preview-1", phase: "done", ratio: 1, message: "Render complete", outputName: "preview-1.mp4" });
    await waitFor(() => expect(screen.getByTestId("rendered-video")).toBeTruthy());
  });

  it("hides render and segment buttons when there are no clips", async () => {
    getProject.mockResolvedValue({ ...project([]), status: "empty", hasTranscript: false, meta: { ...project([]).meta, status: "empty" } });
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Analyze audio" });
    expect(screen.getByRole("button", { name: "Analyze audio" }).className).toMatch(/bg-primary|default/);
    expect(screen.queryByRole("button", { name: "Show all segments" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Render preview" })).toBeNull();
    expect(screen.getByRole("button", { name: "Rebuild" })).toBeDisabled();
  });

  it("toggles edit mode, adds cuts with S, and saves splitMany once", async () => {
    const clips = [clip({ id: "c-0007", status: "undecided", text: "open me", sourceStart: 0, sourceEnd: 8, duration: 8 })];
    getProject.mockResolvedValue(project(clips));
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    const { container } = render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByText("open me"));
    expect(screen.getByTestId("studio-waveform").getAttribute("data-editing")).toBe("false");
    await userEvent.click(screen.getByTestId("waveform-edit"));
    expect(screen.getByTestId("editing-badge")).toBeTruthy();
    expect(screen.getByTestId("studio-waveform").getAttribute("data-editing")).toBe("true");
    expect(screen.getByRole("button", { name: /Save \(0 cuts/ })).toBeDisabled();

    await userEvent.keyboard("s");
    expect(screen.getByRole("button", { name: /Save \(0 cuts/ })).toBeDisabled();

    const audio = container.querySelector("audio") as HTMLAudioElement;
    let playhead = 2;
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      get: () => playhead,
      set: (value: number) => {
        playhead = value;
      },
    });
    await userEvent.keyboard("s");
    await waitFor(() => expect(screen.getByRole("button", { name: /Save \(1 cuts/ })).toBeEnabled());

    const typing = document.createElement("input");
    document.body.appendChild(typing);
    typing.focus();
    await userEvent.keyboard("s");
    expect(screen.getByRole("button", { name: /Save \(1 cuts/ })).toBeTruthy();
    typing.remove();

    playhead = 4;
    await userEvent.keyboard("s");
    await userEvent.click(screen.getByRole("button", { name: /Save \(2 cuts/ }));
    expect(applyOps).toHaveBeenCalledTimes(1);
    expect(applyOps.mock.calls[0][2]).toEqual([
      { op: "splitMany", clipId: "c-0007", at: expect.any(Array) },
    ]);
    expect((applyOps.mock.calls[0][2][0] as { at: number[] }).at).toHaveLength(2);
  });
});
