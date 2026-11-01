import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
const undo = vi.fn();
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
    undo: (...args: unknown[]) => undo(...args),
    redo: vi.fn(),
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
    undo.mockReset();
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
    await userEvent.click(screen.getByRole("button", { name: "Take 7" }));
    expect(screen.getByTestId("clip-data")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();

    getProject.mockResolvedValue(project([clip({ id: "c-0007", status: "selected", text: "open me" })]));
    emit({ type: "revision", revision: 2 });
    await waitFor(() => expect(screen.getByTestId("status-dot").getAttribute("data-tone")).toBe("accepted"));
  });

  it("keeps issue badges off the clip list and shows them on the open clip", async () => {
    getProject.mockResolvedValue(
      project([clip({ id: "c-0007", status: "undecided", text: "open me", label: "missing_words" })]),
    );
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await screen.findByText("Take 7");
    expect(screen.getByTestId("studio-clips")).not.toHaveTextContent("Missing words");
    expect(screen.getByTestId("studio-clips")).not.toHaveTextContent("missing_words");
    await userEvent.click(screen.getByRole("button", { name: "Take 7" }));
    expect(screen.getByTestId("clip-data")).toBeTruthy();
    expect(screen.getByTestId("controls-issue")).toHaveTextContent("Missing words");
    expect(screen.getAllByText("Missing words").length).toBeGreaterThanOrEqual(2);
  });

  it("sends accept and reject ops and keeps the clip in the list", async () => {
    const clips = [clip({ id: "c-0007", status: "undecided", text: "open me" })];
    getProject.mockResolvedValue(project(clips));
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Take 7" }));
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(applyOps).toHaveBeenCalledWith("real", 1, [{ op: "select", clipId: "c-0007" }], "select");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(applyOps).toHaveBeenCalledWith("real", 1, [{ op: "reject", clipId: "c-0007" }], "reject");
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
    emit({ type: "render", renderId: "preview-1", phase: "rendering", ratio: 0.4, message: "Rendering… 40%" });
    await waitFor(() => {
      const label = screen.getByTestId("render-progress");
      expect(label).toHaveTextContent("Rendering… 40%");
      expect(label.textContent?.match(/%/g)).toEqual(["%"]);
    });
    emit({ type: "render", renderId: "preview-1", phase: "done", ratio: 1, message: "Render complete", outputName: "preview-1.mp4" });
    await waitFor(() => expect(screen.getByTestId("rendered-video")).toBeTruthy());
  });

  it("shows a single percent for analysis progress", async () => {
    getProject.mockResolvedValue({
      ...project([]),
      status: "analyzing",
      hasTranscript: false,
      meta: { ...project([]).meta, status: "analyzing", statusMessage: "Analyzing…" },
    });
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Analyze audio" });
    emit({ type: "progress", message: "Transcribing… 2%", ratio: 0.03 });
    await waitFor(() => {
      expect(screen.getAllByText("Transcribing… 2%").length).toBeGreaterThan(0);
      expect(screen.queryByText(/2%\s+3%/)).toBeNull();
    });
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

  it("offers rebuild with and without script only when a script exists", async () => {
    getProject.mockResolvedValue({
      ...project([clip({ id: "c-0001", status: "selected" })]),
      script: "hello world\nsecond",
      meta: { ...project([]).meta, scriptLineCount: 2, lastPipeline: "scripted" },
    });
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Rebuild" });
    await userEvent.click(screen.getByRole("button", { name: "Rebuild" }));
    expect(screen.getByTestId("rebuild-with-script")).toBeTruthy();
    expect(screen.getByTestId("rebuild-without-script")).toBeTruthy();
  });

  it("labels scripted groups as Line N with take counts", async () => {
    getProject.mockResolvedValue({
      ...project([
        clip({ id: "c-0001", status: "selected", groupId: "g-0001" }),
        clip({ id: "c-0002", status: "rejected", groupId: "g-0001" }),
      ]),
      groups: [{ id: "g-0001", label: "hello", clipIds: ["c-0001", "c-0002"], recommendedClipId: "c-0001", scriptLine: 4 }],
      script: "hello",
      meta: { ...project([]).meta, lastPipeline: "scripted", scriptLineCount: 4 },
    });
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await screen.findByText("Line 4 · 2 takes");
  });

  it("disables Analyze when the project has no source video", async () => {
    getProject.mockResolvedValue({
      ...project([]),
      status: "empty",
      hasTranscript: false,
      meta: { ...project([]).meta, sourcePath: null, status: "empty" },
    });
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Analyze audio" });
    expect(screen.getByRole("button", { name: "Analyze audio" })).toBeDisabled();
  });

  it("toggles edit mode, adds cuts with S, and saves splitMany once", async () => {
    const clips = [clip({ id: "c-0007", status: "undecided", text: "open me", sourceStart: 0, sourceEnd: 8, duration: 8 })];
    getProject.mockResolvedValue(project(clips));
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Take 7" }));
    expect(screen.getByTestId("studio-waveform").getAttribute("data-editing")).toBe("false");
    await userEvent.click(screen.getByTestId("waveform-edit"));
    expect(screen.getByTestId("editing-badge")).toBeTruthy();
    expect(screen.getByTestId("studio-waveform").getAttribute("data-editing")).toBe("true");
    expect(screen.getByRole("button", { name: /Save \(0 cuts/ })).toBeDisabled();

    await userEvent.keyboard("s");
    expect(screen.getByRole("button", { name: /Save \(0 cuts/ })).toBeDisabled();

    const wave = screen.getByTestId("studio-waveform");
    Object.defineProperty(wave, "clientWidth", { configurable: true, value: 800 });
    vi.spyOn(wave, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 120,
      width: 800,
      height: 120,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(wave, { clientX: 400 });
    await userEvent.keyboard("s");
    await waitFor(() => expect(screen.getByRole("button", { name: /Save \(1 cuts/ })).toBeEnabled());

    const typing = document.createElement("input");
    document.body.appendChild(typing);
    typing.focus();
    await userEvent.keyboard("s");
    expect(screen.getByRole("button", { name: /Save \(1 cuts/ })).toBeTruthy();
    typing.remove();

    fireEvent.pointerDown(wave, { clientX: 700 });
    await userEvent.keyboard("s");
    await userEvent.click(screen.getByRole("button", { name: /Save \(2 cuts/ }));
    expect(applyOps).toHaveBeenCalledTimes(1);
    expect(applyOps.mock.calls[0][2]).toEqual([
      { op: "splitMany", clipId: "c-0007", at: expect.any(Array) },
    ]);
    const at = (applyOps.mock.calls[0][2][0] as { at: number[] }).at;
    expect(at).toHaveLength(2);
    expect(at[0]).toBeCloseTo(2, 1);
    expect(at[1]).toBeCloseTo(3.5, 1);
    expect(at[0]).toBeGreaterThan(0.5);
  });

  it("toggles Collapse all and Expand all on visible groups", async () => {
    getProject.mockResolvedValue(
      project([
        clip({ id: "c-0001", status: "selected", text: "one" }),
        clip({ id: "c-0002", status: "undecided", text: "two" }),
      ]),
    );
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await screen.findByText("Take 1");
    const toggle = screen.getByTestId("toggle-all-groups");
    expect(toggle).toHaveAttribute("aria-label", "Collapse all");
    await userEvent.click(toggle);
    expect(screen.queryByRole("button", { name: "Take 1" })).toBeNull();
    expect(toggle).toHaveAttribute("aria-label", "Expand all");
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Take 1" })).toBeTruthy();
    expect(toggle).toHaveAttribute("aria-label", "Collapse all");
  });

  it("collapses only the double-clicked group and keeps the clip selected", async () => {
    const clips = [
      clip({ id: "c-0001", status: "undecided", text: "alpha", groupId: "g-0001" }),
      clip({ id: "c-0002", status: "undecided", text: "beta", groupId: "g-0001" }),
      clip({ id: "c-0003", status: "undecided", text: "gamma", groupId: "g-0002" }),
    ];
    getProject.mockResolvedValue({
      ...project(clips),
      groups: [
        { id: "g-0001", label: "First group", clipIds: ["c-0001", "c-0002"], recommendedClipId: "c-0001" },
        { id: "g-0002", label: "Second group", clipIds: ["c-0003"], recommendedClipId: "c-0003" },
      ],
    });
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Take 1" }));
    expect(screen.getByTestId("clip-data")).toHaveTextContent("c-0002");
    await userEvent.dblClick(screen.getByRole("button", { name: "Take 1" }));
    expect(screen.queryByRole("button", { name: "Take 1" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Take 2" })).toBeNull();
    expect(screen.getByRole("button", { name: "Take 3" })).toBeTruthy();
    expect(screen.getByTestId("clip-data")).toHaveTextContent("c-0002");
    expect(screen.getByText("Take 1")).toBeTruthy();
  });

  it("puts Copy JSON before Raw JSON and Undo/Redo in the preview tabs", async () => {
    getProject.mockResolvedValue(project([clip({ id: "c-0007", status: "undecided", text: "open me" })]));
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    const tabs = await screen.findByTestId("preview-tabs");
    expect(tabs.querySelector('[aria-label="Undo"]')).toBeTruthy();
    expect(tabs.querySelector('[aria-label="Redo"]')).toBeTruthy();
    expect(tabs).toHaveTextContent("Undo");
    expect(tabs).toHaveTextContent("Redo");
    await userEvent.click(screen.getByRole("button", { name: "Take 7" }));
    const data = screen.getByTestId("clip-data");
    const copy = screen.getByRole("button", { name: "Copy JSON" });
    const raw = screen.getByRole("button", { name: "Raw JSON" });
    expect(data.contains(copy)).toBe(true);
    expect(copy.compareDocumentPosition(raw) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the transcript as wrapping text with a scrollable body", async () => {
    getProject.mockResolvedValue(project([clip({ id: "c-0007", status: "undecided", text: "open me" })]));
    getTranscript.mockResolvedValue({
      words: [
        { text: "hello", start: 0, end: 0.2, clipId: "c-0007" },
        { text: "world", start: 0.2, end: 0.4, clipId: "c-0007" },
        { text: "aside", start: 0.4, end: 0.5, clipId: null },
      ],
    });
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "View transcript" }));
    const body = await screen.findByTestId("transcript-body");
    expect(body.className).toMatch(/overflow-y-auto/);
    expect(body).toHaveTextContent("hello world aside");
    await userEvent.type(screen.getByPlaceholderText(/search transcript/i), "ell");
    expect(body.querySelector("mark")).toHaveTextContent("ell");
    expect(body).toHaveTextContent("world");
    expect(body).toHaveTextContent("aside");
    expect(screen.getByText("1 matches")).toBeTruthy();
  });

  it("moves the selection with j and k", async () => {
    getProject.mockResolvedValue(
      project([
        clip({ id: "c-0001", status: "undecided", text: "first take" }),
        clip({ id: "c-0002", status: "undecided", text: "second take" }),
      ]),
    );
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await screen.findByText("first take");
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => expect(applyOps).toHaveBeenCalled());
    expect(applyOps.mock.calls.at(-1)?.[2]).toEqual([expect.objectContaining({ op: "select", clipId: "c-0002" })]);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "r" });
    await waitFor(() => expect(applyOps.mock.calls.length).toBeGreaterThan(1));
    expect(applyOps.mock.calls.at(-1)?.[2]).toEqual([expect.objectContaining({ op: "reject", clipId: "c-0001" })]);
  });

  it("goes to the studio home when the project is deleted over SSE", async () => {
    getProject.mockResolvedValue(project([clip({ id: "c-0001", status: "selected", text: "kept" })]));
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter initialEntries={["/studio/real"]}>
        <Routes>
          <Route path="/studio" element={<div>studio home</div>} />
          <Route path="/studio/:slug" element={<StudioWorkspace slug="real" />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("kept");
    emit({ type: "deleted" });
    expect(await screen.findByText("studio home")).toBeInTheDocument();
  });

  it.fails("BUG: Studio has no undo/redo keyboard shortcut", async () => {
    getProject.mockResolvedValue(project([clip({ id: "c-0001", status: "selected", text: "kept" })]));
    const { StudioWorkspace } = await import("@/pages/studio/StudioWorkspace");
    render(
      <MemoryRouter>
        <StudioWorkspace slug="real" />
      </MemoryRouter>,
    );
    await screen.findByText("kept");
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(undo).toHaveBeenCalled();
  });
});
