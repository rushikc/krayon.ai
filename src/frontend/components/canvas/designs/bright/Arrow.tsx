import type { MouseEvent } from "react";

import { findBoxById, getArrowGeometry } from "@/lib/canvas-geometry";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvas-store";

import type { DesignArrowProps } from "../types";

export function Arrow({
  arrow,
  boxes,
  selected,
  markerPrefix,
}: DesignArrowProps) {
  const selectElement = useCanvasStore((state) => state.selectElement);
  const source = findBoxById(boxes, arrow.sourceId);
  const target = findBoxById(boxes, arrow.targetId);

  if (!source || !target) {
    return null;
  }

  const geometry = getArrowGeometry(source, target);

  if (!geometry) {
    return null;
  }

  function handleSelect(event: MouseEvent) {
    event.stopPropagation();
    selectElement(arrow.id);
  }

  return (
    <g className="origin-center animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      <line
        x1={geometry.x1}
        y1={geometry.y1}
        x2={geometry.x2}
        y2={geometry.y2}
        className="pointer-events-auto stroke-transparent"
        strokeWidth={12}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        onClick={handleSelect}
      />
      <line
        x1={geometry.x1}
        y1={geometry.y1}
        x2={geometry.x2}
        y2={geometry.y2}
        className={cn(
          "pointer-events-none",
          selected ? "stroke-primary" : "stroke-[var(--ds-ink)]",
        )}
        strokeWidth={2.5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        strokeDasharray={arrow.variant === "dashed" ? "6 5" : undefined}
        markerEnd={`url(#${markerPrefix}-arrowhead)`}
      />
    </g>
  );
}
