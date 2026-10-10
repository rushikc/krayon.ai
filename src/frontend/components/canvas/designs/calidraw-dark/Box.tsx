import {
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  clampBoxBounds,
  DEFAULT_BOX_FONT_SIZE,
  matrixToPercents,
  percentsToMatrix,
  scaleBox,
  ZOOM_FACTOR,
} from "@/lib/canvas-geometry";
import { isZoomInKey, isZoomOutKey } from "@/lib/canvas-keyboard";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvas-store";
import {
  beginTimelineHistoryTransaction,
  endTimelineHistoryTransaction,
} from "@/stores/timeline-history";
import type { ColorTheme } from "@/types/canvas";

import type { DesignBoxProps } from "../types";
import { SketchFrame } from "./SketchFrame";

const themeStrokes: Record<ColorTheme, string> = {
  ink: "var(--ds-stroke-ink)",
  violet: "var(--ds-stroke-violet)",
  green: "var(--ds-stroke-green)",
  blue: "var(--ds-stroke-blue)",
  sky: "var(--ds-stroke-sky)",
  lavender: "var(--ds-stroke-lavender)",
  mint: "var(--ds-stroke-mint)",
  tan: "var(--ds-stroke-tan)",
  yellow: "var(--ds-stroke-yellow)",
  orange: "var(--ds-stroke-orange)",
  pink: "var(--ds-stroke-pink)",
  salmon: "var(--ds-stroke-salmon)",
};

const NUDGE_STEP = 1;
const NUDGE_STEP_SHIFT = 5;

export function Box({ node, selected, canvasRef }: DesignBoxProps) {
  const selectElement = useCanvasStore((state) => state.selectElement);
  const updateElement = useCanvasStore((state) => state.updateElement);
  const rect = matrixToPercents(node.matrix);
  const aspect = rect.height > 0 ? rect.width / rect.height : 1;
  const dragOffset = useRef<{
    pointerId: number;
    dx: number;
    dy: number;
  } | null>(null);
  const labelSize = node.fontSize ?? DEFAULT_BOX_FONT_SIZE;
  const sublabelSize = labelSize * 0.75;

  function toPercent(event: PointerEvent<HTMLDivElement>) {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) {
      return null;
    }

    return {
      x: ((event.clientX - bounds.left) / bounds.width) * 100,
      y: ((event.clientY - bounds.top) / bounds.height) * 100,
    };
  }

  function moveTo(x: number, y: number) {
    const next = clampBoxBounds({
      x,
      y,
      width: rect.width,
      height: rect.height,
    });
    const matrix = percentsToMatrix({
      left: next.x,
      top: next.y,
      width: next.width,
      height: next.height,
    });

    if (
      matrix[0] === node.matrix[0] &&
      matrix[1] === node.matrix[1] &&
      matrix[2] === node.matrix[2] &&
      matrix[3] === node.matrix[3]
    ) {
      return;
    }

    updateElement(node.id, { matrix });
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();
    selectElement(node.id);
    event.currentTarget.focus();

    const pointer = toPercent(event);
    if (!pointer) {
      return;
    }

    dragOffset.current = {
      pointerId: event.pointerId,
      dx: pointer.x - rect.left,
      dy: pointer.y - rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    beginTimelineHistoryTransaction();
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragOffset.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const pointer = toPercent(event);
    if (!pointer) {
      return;
    }

    moveTo(pointer.x - drag.dx, pointer.y - drag.dy);
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const drag = dragOffset.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragOffset.current = null;
    endTimelineHistoryTransaction();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      selectElement(node.id);
      return;
    }

    if (isZoomInKey(event) || isZoomOutKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      const scaled = scaleBox(
        {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        },
        isZoomInKey(event) ? ZOOM_FACTOR : 1 / ZOOM_FACTOR,
      );
      updateElement(node.id, {
        matrix: percentsToMatrix({
          left: scaled.x,
          top: scaled.y,
          width: scaled.width,
          height: scaled.height,
        }),
      });
      return;
    }

    const step = event.shiftKey ? NUDGE_STEP_SHIFT : NUDGE_STEP;
    let nextX = rect.left;
    let nextY = rect.top;

    switch (event.key) {
      case "ArrowLeft":
        nextX -= step;
        break;
      case "ArrowRight":
        nextX += step;
        break;
      case "ArrowUp":
        nextY -= step;
        break;
      case "ArrowDown":
        nextY += step;
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectElement(node.id);
    moveTo(nextX, nextY);
  }

  return (
    <div
      className="absolute cursor-grab touch-none rounded-lg outline-none animate-in fade-in-0 slide-in-from-bottom-2 duration-300 active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ds-surface)]"
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Select and drag ${node.label}`}
      style={{
        left: `${rect.left}%`,
        top: `${rect.top}%`,
        width: `${rect.width}%`,
        height: `${rect.height}%`,
        zIndex: 100 - node.time.track,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      <div
        className={cn(
          "relative flex size-full flex-col items-start justify-center gap-0.5 rounded-none border-0 bg-transparent px-4 py-2 text-left shadow-none",
          selected &&
            "ring-2 ring-primary ring-offset-2 ring-offset-[var(--ds-surface)]",
        )}
        style={{ color: "var(--ds-ink)", fontFamily: "var(--ds-font)" }}
      >
        <SketchFrame
          id={node.id}
          kind="rect"
          stroke={themeStrokes[node.colorTheme]}
          fill="var(--ds-surface)"
          aspect={aspect}
        />
        <span
          className="relative z-[1] w-full whitespace-normal break-words font-bold"
          style={{ fontSize: `${labelSize}px` }}
        >
          {node.label}
        </span>
        {node.sublabel && (
          <span
            className="relative z-[1] w-full whitespace-normal break-words font-medium"
            style={{ fontSize: `${sublabelSize}px`, opacity: 0.72 }}
          >
            {node.sublabel}
          </span>
        )}
      </div>
    </div>
  );
}
