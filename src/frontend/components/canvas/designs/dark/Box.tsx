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

const themeFills: Record<ColorTheme, string> = {
  ink: "var(--ds-fill-ink)",
  violet: "var(--ds-fill-violet)",
  green: "var(--ds-fill-green)",
  blue: "var(--ds-fill-blue)",
  sky: "var(--ds-fill-sky)",
  lavender: "var(--ds-fill-lavender)",
  mint: "var(--ds-fill-mint)",
  tan: "var(--ds-fill-tan)",
  yellow: "var(--ds-fill-yellow)",
  orange: "var(--ds-fill-orange)",
  pink: "var(--ds-fill-pink)",
  salmon: "var(--ds-fill-salmon)",
};

const NUDGE_STEP = 1;
const NUDGE_STEP_SHIFT = 5;

export function Box({ node, selected, canvasRef }: DesignBoxProps) {
  const selectElement = useCanvasStore((state) => state.selectElement);
  const updateElement = useCanvasStore((state) => state.updateElement);
  const rect = matrixToPercents(node.matrix);
  const dragOffset = useRef<{
    pointerId: number;
    dx: number;
    dy: number;
  } | null>(null);
  const labelSize = node.fontSize ?? DEFAULT_BOX_FONT_SIZE;
  const sublabelSize = labelSize * 0.75;
  const inkOnFill = node.colorTheme === "ink";

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
          "flex size-full flex-col justify-center gap-0.5 rounded-lg border-2 px-3 shadow-[3px_3px_0_0_var(--ds-ink)] transition-shadow",
          node.sublabel ? "items-start text-left" : "items-center text-center",
          selected &&
            "ring-2 ring-primary ring-offset-2 ring-offset-[var(--ds-surface)]",
        )}
        style={{
          borderColor: "var(--ds-ink)",
          backgroundColor: themeFills[node.colorTheme],
          color: inkOnFill ? "var(--ds-surface)" : "var(--ds-ink)",
          fontFamily: "var(--ds-font)",
        }}
      >
        <span
          className="relative z-[1] w-full truncate font-bold"
          style={{ fontSize: `${labelSize}px` }}
        >
          {node.label}
        </span>
        {node.sublabel && (
          <span
            className="relative z-[1] w-full truncate font-medium"
            style={{
              fontSize: `${sublabelSize}px`,
              color: inkOnFill
                ? "color-mix(in srgb, var(--ds-surface) 75%, transparent)"
                : "color-mix(in srgb, var(--ds-ink) 75%, transparent)",
            }}
          >
            {node.sublabel}
          </span>
        )}
      </div>
    </div>
  );
}
