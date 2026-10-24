import { useRef } from "react";

import {
  segmentWidthPercent,
  timeToPercent,
} from "@/components/editor/timeline/lib/timeMath";
import { cn } from "@/lib/utils";
import { getElementLabel, type CanvasElement } from "@/types/canvas";

import type { useSegmentDrag } from "./hooks/useSegmentDrag";
import type { useSegmentResize } from "./hooks/useSegmentResize";

type DragHandlers = ReturnType<typeof useSegmentDrag>;
type ResizeHandlers = ReturnType<typeof useSegmentResize>;

const TYPE_BLOCK_CLASS: Record<CanvasElement["type"], string> = {
  box: "bg-[var(--timeline-box-bg)] border-[var(--timeline-box-border)] text-[var(--timeline-box-fg)]",
  number:
    "bg-[var(--timeline-number-bg)] border-[var(--timeline-number-border)] text-[var(--timeline-number-fg)]",
  arrow:
    "bg-[var(--timeline-arrow-bg)] border-[var(--timeline-arrow-border)] text-[var(--timeline-arrow-fg)]",
};

interface SegmentBlockProps {
  element: CanvasElement;
  duration: number;
  selected: boolean;
  drag: DragHandlers;
  resize: ResizeHandlers;
}

export function SegmentBlock({
  element,
  duration,
  selected,
  drag,
  resize,
}: SegmentBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const segment = {
    id: element.id,
    start: element.time.start,
    end: element.time.end,
    track: element.time.track,
  };
  const { start, end } = resize.getSegmentDisplayTiming(segment);
  const isDragging = drag.draggingSegmentId === element.id;
  const isResizing = resize.resizingSegmentId === element.id;
  const showHandles = !isDragging && (!resize.isResizing || isResizing);
  const label = getElementLabel(element);

  return (
    <div
      ref={containerRef}
      data-timeline-interactive="true"
      data-segment-type={element.type}
      className={cn(
        "group absolute inset-y-0.5 will-change-transform",
        selected ? "z-40" : "z-10",
        isDragging ? "cursor-grabbing" : resize.isResizing ? "cursor-ew-resize" : "",
      )}
      style={{
        left: timeToPercent(start, duration),
        width: segmentWidthPercent(start, end, duration),
      }}
      onPointerCancel={drag.onSegmentPointerCancel}
      onPointerMove={drag.onSegmentPointerMove}
      onPointerUp={drag.onSegmentPointerUp}
    >
      <div
        className={cn(
          "relative h-full overflow-hidden rounded border text-left transition-[box-shadow]",
          TYPE_BLOCK_CLASS[element.type],
          selected && "ring-2 ring-primary ring-offset-1 ring-offset-card",
        )}
        onPointerDown={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-segment-resize-handle="true"]')
          ) {
            return;
          }
          const container = containerRef.current;
          if (!container) {
            return;
          }
          drag.onSegmentPointerDown(event, segment, container);
        }}
      >
        {showHandles ? (
          <>
            <button
              type="button"
              data-segment-resize-handle="true"
              aria-label={`Resize ${label} start`}
              className={cn(
                "absolute inset-y-0 left-0 z-10 flex w-2 cursor-ew-resize touch-none items-stretch justify-start border-0 bg-transparent p-0",
                "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
                (isResizing || selected) && "opacity-100",
              )}
              onPointerDown={(event) =>
                resize.onResizePointerDown(event, segment, "left")
              }
            >
              <span
                className="pointer-events-none block h-full w-0.5 bg-current/40"
                aria-hidden
              />
            </button>
            <button
              type="button"
              data-segment-resize-handle="true"
              aria-label={`Resize ${label} end`}
              className={cn(
                "absolute inset-y-0 right-0 z-10 flex w-2 cursor-ew-resize touch-none items-stretch justify-end border-0 bg-transparent p-0",
                "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
                (isResizing || selected) && "opacity-100",
              )}
              onPointerDown={(event) =>
                resize.onResizePointerDown(event, segment, "right")
              }
            >
              <span
                className="pointer-events-none ml-auto block h-full w-0.5 bg-current/40"
                aria-hidden
              />
            </button>
          </>
        ) : null}

        <div
          className={cn(
            "relative z-0 flex h-full flex-col items-start justify-center gap-0 px-1.5",
            isDragging
              ? "cursor-grabbing"
              : resize.isResizing
                ? "cursor-ew-resize"
                : "cursor-grab",
          )}
        >
          <span className="max-w-full truncate text-[9px] leading-none font-medium uppercase tracking-wide opacity-80">
            {element.type}
          </span>
          <span className="max-w-full truncate text-[11px] leading-tight font-medium">
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}
