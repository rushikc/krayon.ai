import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioClip } from "@/lib/api/studio-client";
import { studioCopy } from "@/lib/studio-copy";
import { StudioPreviewPanel } from "@/pages/studio/StudioPreviewPanel";

vi.mock("@/lib/api/studio-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/studio-client")>("@/lib/api/studio-client");
  return {
    ...actual,
    getClipPeaks: vi.fn(async () => ({ duration: 3, peaks: [0, 0.4, -0.2, 0.5] })),
    audioUrl: () => "/audio.wav",
    sourceUrl: () => "/source.mp4",
    outputUrl: () => "/out.mp4",
  };
});

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const store: Record<string, unknown> = {};
    return new Proxy(store, {
      get(target, prop) {
        if (typeof prop !== "string") return undefined;
        if (!(prop in target)) target[prop] = () => undefined;
        return target[prop];
      },
      set(target, prop, value) {
        target[prop as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  });
});

function clip(): StudioClip {
  return {
    id: "c-0001",
    parentIds: [],
    sourceStart: 0,
    sourceEnd: 3,
    ranges: [{ sourceStart: 0, sourceEnd: 3 }],
    duration: 3,
    text: "alpha beta",
    words: [
      { text: "alpha", start: 0.2, end: 0.6 },
      { text: "beta", start: 0.8, end: 1.2 },
    ],
    groupId: "g-0001",
    label: "none",
    score: 1,
    reasons: [],
    status: "undecided",
    decidedBy: "algorithm",
    note: "",
  };
}

function renderPreview() {
  const onUndo = vi.fn();
  const onRedo = vi.fn();
  const onTabChange = vi.fn();
  render(
    <StudioPreviewPanel
      slug="demo"
      clip={clip()}
      groups={[{ id: "g-0001", label: "alpha beta", clipIds: ["c-0001"], recommendedClipId: "c-0001" }]}
      pad={0.05}
      tab="clip"
      onTabChange={onTabChange}
      conflictError={null}
      renders={[]}
      activeRenderName={null}
      onSelectRender={vi.fn()}
      onAccept={vi.fn()}
      onReject={vi.fn()}
      onPrev={vi.fn()}
      onNext={vi.fn()}
      autoPlayToken={0}
      playingRef={{ current: false }}
      onUndo={onUndo}
      onRedo={onRedo}
    />,
  );
  return { onUndo, onRedo, onTabChange };
}

describe("StudioPreviewPanel", () => {
  it("switches tabs and shows undo and redo with their words", async () => {
    const { onUndo, onRedo, onTabChange } = renderPreview();
    expect(screen.getByRole("button", { name: studioCopy.clipAudio })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: studioCopy.fullVideo }));
    expect(onTabChange).toHaveBeenCalledWith("source");
    await userEvent.click(screen.getByRole("button", { name: studioCopy.renderedVideo }));
    expect(onTabChange).toHaveBeenCalledWith("render");
    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo).toHaveTextContent("Undo");
    expect(redo).toHaveTextContent("Redo");
    expect(undo.querySelector("svg")).toBeTruthy();
    expect(redo.querySelector("svg")).toBeTruthy();
    await userEvent.click(undo);
    await userEvent.click(redo);
    expect(onUndo).toHaveBeenCalled();
    expect(onRedo).toHaveBeenCalled();
  });

  it("puts Copy JSON before the raw toggle and the pre", async () => {
    renderPreview();
    const copy = screen.getByRole("button", { name: studioCopy.copyJson });
    const raw = screen.getByRole("button", { name: studioCopy.rawJson });
    expect(copy.compareDocumentPosition(raw) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(raw);
    const pre = screen.getByText(/"id": "c-0001"/);
    expect(pre.tagName).toBe("PRE");
    expect(raw.compareDocumentPosition(pre) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("adds a cut with S only while editing", async () => {
    renderPreview();
    fireEvent.keyDown(window, { key: "s" });
    expect(screen.queryByText(studioCopy.cutTooClose)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: studioCopy.edit }));
    fireEvent.keyDown(window, { key: "S" });
    expect(screen.getByText(studioCopy.cutTooClose)).toBeInTheDocument();
  });
});
