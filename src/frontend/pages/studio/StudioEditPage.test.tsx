import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudioClip, StudioProject } from "@/lib/api/studio-client";
import { followPlayheadScrollLeft, nextEditZoom, zoomPreserveScrollLeft } from "@/pages/studio/StudioEditWaveform";

const applyOps = vi.fn();
const getClipPeaks = vi.fn();
const getProject = vi.fn();

vi.mock("@/lib/api/studio-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/studio-client")>("@/lib/api/studio-client");
  return {
    ...actual,
    applyOps: (...args: unknown[]) => applyOps(...args),
    getClipPeaks: (...args: unknown[]) => getClipPeaks(...args),
    getProject: (...args: unknown[]) => getProject(...args),
    undo: vi.fn(async () => ({ revision: 2 })),
    redo: vi.fn(async () => ({ revision: 3 })),
    eventsUrl: () => "/events",
    cutAudioUrl: () => "/cut.wav",
  };
});

function clip(partial: Partial<StudioClip> & Pick<StudioClip, "id" | "status">): StudioClip {
  return {
    parentIds: [],
    sourceStart: 0,
    sourceEnd: 2,
    ranges: [{ sourceStart: 0, sourceEnd: 2 }],
    duration: 2,
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
    silenceBefore: 0,
    silenceAfter: 0,
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
    },
    revision: 1,
    status: "ready",
    hasTranscript: true,
    clips,
    groups: [{ id: "g-0001", label: "line", clipIds: clips.map((item) => item.id), recommendedClipId: clips[0]?.id ?? null }],
    order: clips.filter((item) => item.status === "selected").map((item) => item.id),
    history: [],
  };
}

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  close() {}
}

vi.stubGlobal("EventSource", FakeEventSource);

class FakeResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe() {
    this.callback([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

function renderEdit() {
  return render(
    <MemoryRouter initialEntries={["/studio/real/edit"]}>
      <Routes>
        <Route path="/studio/:slug/edit" element={<StudioEditPageLazy />} />
      </Routes>
    </MemoryRouter>,
  );
}

let StudioEditPageLazy: typeof import("@/pages/studio/StudioEditPage").StudioEditPage;

describe("StudioEditPage", () => {
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
    Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  });

  beforeEach(async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get() {
        return (this as HTMLMediaElement & { _paused?: boolean })._paused !== false;
      },
    });
    HTMLMediaElement.prototype.play = function play() {
      (this as HTMLMediaElement & { _paused?: boolean })._paused = false;
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      (this as HTMLMediaElement & { _paused?: boolean })._paused = true;
      this.dispatchEvent(new Event("pause"));
    };
    ({ StudioEditPage: StudioEditPageLazy } = await import("@/pages/studio/StudioEditPage"));
    applyOps.mockReset().mockResolvedValue({ revision: 2, summary: "ok", order: ["c-0001"] });
    getClipPeaks.mockReset().mockResolvedValue({ duration: 2, peaks: Array.from({ length: 16 }, () => 0.2) });
    getProject.mockReset().mockResolvedValue(
      project([
        clip({ id: "c-0001", status: "selected", text: "kept take" }),
        clip({ id: "c-0002", status: "rejected", text: "skip this", sourceStart: 3, sourceEnd: 5 }),
      ]),
    );
  });

  it("shows the concatenated waveform, accept, and show-all toggle", async () => {
    renderEdit();
    expect(await screen.findByTestId("studio-edit-page")).toBeInTheDocument();
    expect(screen.getByTestId("studio-edit-waveform")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show all segments" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 Clips" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 Edit" })).toBeInTheDocument();
    expect(screen.getByTestId("edit-transcript")).toHaveTextContent("kept take");
    await userEvent.click(screen.getByRole("button", { name: "Show all segments" }));
    expect(screen.getByRole("button", { name: "Show all segments" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(applyOps).toHaveBeenCalled());
    expect(applyOps.mock.calls[0]?.[2]).toEqual([expect.objectContaining({ op: "select", clipId: "c-0001" })]);
  });

  it("zooms the waveform in and keeps zoom-out disabled at fit", async () => {
    renderEdit();
    const wave = await screen.findByTestId("studio-edit-waveform");
    expect(wave).toHaveAttribute("data-zoom", "1");
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(wave).toHaveAttribute("data-zoom", "1.1");
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeEnabled();
    const scroller = screen.getByTestId("studio-edit-wave-scroll");
    expect(scroller.className).not.toMatch(/scrollbar-width:none/);
  });

  it("orders previous, play, and next in the transport row", async () => {
    renderEdit();
    const previous = await screen.findByRole("button", { name: "Previous clip" });
    const play = screen.getByRole("button", { name: "Play" });
    const next = screen.getByRole("button", { name: "Next clip" });
    expect(previous.compareDocumentPosition(play) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(play.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("skips to the next clip start and keeps the bottom splitter", async () => {
    getProject.mockResolvedValue(twoSelectedClips());
    renderEdit();
    expect(await screen.findByText("0:00 / 0:04")).toBeInTheDocument();
    expect(screen.getByTestId("edit-bottom-resize")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next clip" }));
    expect(screen.getByText("0:02 / 0:04")).toBeInTheDocument();
  });

  it("seeks to clip start on the first wave click and the clicked time on the second", async () => {
    getProject.mockResolvedValue(twoSelectedClips());
    const width = 400;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 240 });
    renderEdit();
    const wave = await screen.findByTestId("studio-edit-waveform");
    await waitFor(() => expect(document.querySelector("canvas")?.style.width).toBe("400px"));
    vi.spyOn(wave, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width,
      height: 240,
      top: 0,
      left: 0,
      bottom: 240,
      right: width,
      toJSON() {},
    });
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1000);
    fireEvent.pointerDown(wave, { clientX: width * 0.75, clientY: 10, pointerType: "mouse" });
    expect(screen.getByText("0:02 / 0:04")).toBeInTheDocument();
    now.mockReturnValue(1500);
    fireEvent.pointerDown(wave, { clientX: width * 0.75, clientY: 10, pointerType: "mouse" });
    expect(screen.getByText("0:03 / 0:04")).toBeInTheDocument();
  });

  async function seekAudioTo(time: number) {
    const audio = await waitFor(() => {
      const node = document.querySelector("audio");
      expect(node).not.toBeNull();
      return node as HTMLAudioElement;
    });
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: time });
    fireEvent.timeUpdate(audio);
  }

  it("selects the clip under the playhead as time updates", async () => {
    getProject.mockResolvedValue(twoSelectedClips());
    renderEdit();
    expect(await screen.findByTestId("edit-transcript")).toHaveTextContent("take one");
    await seekAudioTo(2.5);
    expect(screen.getByTestId("edit-transcript")).toHaveTextContent("take two");
  });

  it("adds a cut on the playhead clip, not the first clip", async () => {
    getProject.mockResolvedValue(twoSelectedClips());
    renderEdit();
    await screen.findByTestId("edit-transcript");
    await seekAudioTo(2.5);
    expect(screen.getByTestId("edit-transcript")).toHaveTextContent("take two");
    await userEvent.click(screen.getByRole("button", { name: "Add cut at playhead" }));
    await userEvent.click(screen.getByRole("button", { name: /Save \(1 cuts/ }));
    await waitFor(() => expect(applyOps).toHaveBeenCalled());
    expect(applyOps.mock.calls[0]?.[2]).toEqual([
      expect.objectContaining({ op: "splitMany", clipId: "c-0002", at: [2.5] }),
    ]);
  });

  it("defaults the bottom pane to 200px when localStorage is empty and lets it scroll", async () => {
    localStorage.removeItem("krayon-studio-edit-bottom");
    renderEdit();
    await screen.findByTestId("studio-edit-page");
    const pane = screen.getByTestId("edit-bottom-resize").nextElementSibling;
    expect(pane).toHaveStyle({ height: "200px" });
    expect(pane).toHaveClass("overflow-y-auto");
  });

  it("names the play button Play while paused and does not set an empty audio src", async () => {
    renderEdit();
    expect(await screen.findByRole("button", { name: "Play" })).toBeInTheDocument();
    const audio = document.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute("src")).not.toBe("");
  });

  async function mockWaveRect(width = 400) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 240 });
    const wave = await screen.findByTestId("studio-edit-waveform");
    vi.spyOn(wave, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width,
      height: 240,
      top: 0,
      left: 0,
      bottom: 240,
      right: width,
      toJSON() {},
    });
    return wave;
  }

  it("toggles playback on a double-tap and still two-step seeks when taps are spaced", async () => {
    getProject.mockResolvedValue(twoSelectedClips());
    renderEdit();
    const wave = await mockWaveRect();
    await waitFor(() => expect(document.querySelector("canvas")?.style.width).toBe("400px"));
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1000);
    fireEvent.pointerDown(wave, { clientX: 300, clientY: 10, pointerType: "mouse" });
    expect(screen.getByText("0:02 / 0:04")).toBeInTheDocument();
    now.mockReturnValue(1100);
    fireEvent.pointerDown(wave, { clientX: 300, clientY: 10, pointerType: "mouse" });
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByText("0:02 / 0:04")).toBeInTheDocument();
  });

  it("keeps two-step seek when taps are more than 300ms apart", async () => {
    getProject.mockResolvedValue(twoSelectedClips());
    renderEdit();
    const wave = await mockWaveRect();
    await waitFor(() => expect(document.querySelector("canvas")?.style.width).toBe("400px"));
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1000);
    fireEvent.pointerDown(wave, { clientX: 300, clientY: 10, pointerType: "mouse" });
    fireEvent.pointerUp(wave);
    now.mockReturnValue(1500);
    fireEvent.pointerDown(wave, { clientX: 300, clientY: 10, pointerType: "mouse" });
    expect(screen.getByText("0:03 / 0:04")).toBeInTheDocument();
  });

  it("does not treat a drag as a double-tap", async () => {
    getProject.mockResolvedValue(twoSelectedClips());
    renderEdit();
    const wave = await mockWaveRect();
    await waitFor(() => expect(document.querySelector("canvas")?.style.width).toBe("400px"));
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1000);
    fireEvent.pointerDown(wave, { clientX: 300, clientY: 10, pointerType: "mouse", buttons: 1 });
    fireEvent.pointerMove(wave, { clientX: 320, clientY: 10, buttons: 1, movementX: 20 });
    fireEvent.pointerUp(wave);
    now.mockReturnValue(1100);
    fireEvent.pointerDown(wave, { clientX: 300, clientY: 10, pointerType: "mouse" });
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  });

  it("pauses playback on a user horizontal scroll", async () => {
    getProject.mockResolvedValue(twoSelectedClips());
    renderEdit();
    await screen.findByRole("button", { name: "Play" });
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
    fireEvent.scroll(screen.getByTestId("studio-edit-wave-scroll"));
    expect(await screen.findByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("nudges zoom through the slider in 0.1 steps", async () => {
    renderEdit();
    const slider = await screen.findByRole("slider", { name: "Zoom" });
    fireEvent.change(slider, { target: { value: "1.1" } });
    expect(await screen.findByTestId("studio-edit-waveform")).toHaveAttribute("data-zoom", "1.1");
  });
});

describe("nextEditZoom", () => {
  it("steps by 0.1 and does not snap unmatched values to 1", () => {
    expect(nextEditZoom(1, 1)).toBe(1.1);
    expect(nextEditZoom(2.4, 1)).toBe(2.5);
    expect(nextEditZoom(1.07, 1)).not.toBe(1);
    expect(nextEditZoom(1.07, 1)).toBe(1.2);
    expect(nextEditZoom(16, 1)).toBe(16);
    expect(nextEditZoom(1, -1)).toBe(1);
  });
});

describe("zoomPreserveScrollLeft", () => {
  it("keeps the playhead screen X when paused and visible", () => {
    const next = zoomPreserveScrollLeft({
      playing: false,
      playheadXOld: 200,
      playheadXNew: 400,
      oldScroll: 100,
      view: 400,
      newWidth: 800,
      oldWidth: 400,
    });
    expect(next).toBe(300);
  });
});

describe("followPlayheadScrollLeft", () => {
  it("follows the playhead continuously without 72px hops", () => {
    const view = 400;
    const content = 6400;
    let previous = followPlayheadScrollLeft(0, view, content);
    for (let x = 1; x < 2000; x += 1) {
      const next = followPlayheadScrollLeft(x, view, content);
      expect(next).toBeGreaterThanOrEqual(previous);
      expect(next - previous).toBeLessThan(2);
      previous = next;
    }
  });
});

function twoSelectedClips() {
  return project([
    clip({ id: "c-0001", status: "selected", text: "take one" }),
    clip({
      id: "c-0002",
      status: "selected",
      text: "take two",
      sourceStart: 2,
      sourceEnd: 4,
      ranges: [{ sourceStart: 2, sourceEnd: 4 }],
      duration: 2,
    }),
  ]);
}
