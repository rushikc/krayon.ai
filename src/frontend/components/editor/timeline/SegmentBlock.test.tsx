import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SegmentBlock } from "@/components/editor/timeline/SegmentBlock";
import type { CanvasElement } from "@/types/canvas";

const drag = {
  draggingSegmentId: null,
  onSegmentPointerDown: vi.fn(),
  onSegmentPointerMove: vi.fn(),
  onSegmentPointerUp: vi.fn(),
  onSegmentPointerCancel: vi.fn(),
};

const resize = {
  isResizing: false,
  resizingSegmentId: null,
  getSegmentDisplayTiming: (segment: { start: number; end: number }) => segment,
  onResizePointerDown: vi.fn(),
};

function renderType(element: CanvasElement) {
  render(
    <div className="relative h-8">
      <SegmentBlock
        element={element}
        duration={30}
        selected={false}
        drag={drag}
        resize={resize}
      />
    </div>,
  );
}

describe("SegmentBlock", () => {
  it("renders box, number, and arrow with type tokens", () => {
    const box: CanvasElement = {
      id: "b",
      type: "box",
      matrix: [1, 1, 4, 3],
      label: "Client",
      colorTheme: "sky",
      time: { start: 0, end: 10, track: 0 },
    };
    const number: CanvasElement = {
      id: "n",
      type: "number",
      matrix: [0, 1],
      value: 1,
      colorTheme: "ink",
      time: { start: 2, end: 8, track: 0 },
    };
    const arrow: CanvasElement = {
      id: "a",
      type: "arrow",
      sourceId: "b",
      targetId: "c",
      time: { start: 4, end: 12, track: 0 },
    };

    const { unmount } = render(
      <div className="relative h-8">
        <SegmentBlock element={box} duration={30} selected={false} drag={drag} resize={resize} />
      </div>,
    );
    expect(document.querySelector('[data-segment-type="box"]')).toBeTruthy();
    expect(screen.getByText("box")).toBeInTheDocument();
    expect(screen.getByText("Client")).toBeInTheDocument();
    unmount();

    renderType(number);
    expect(document.querySelector('[data-segment-type="number"]')).toBeTruthy();
    expect(screen.getByText("number")).toBeInTheDocument();

    renderType(arrow);
    expect(document.querySelector('[data-segment-type="arrow"]')).toBeTruthy();
    expect(screen.getByText("arrow")).toBeInTheDocument();
  });
});
