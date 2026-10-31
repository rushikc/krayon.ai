import { useEffect, useMemo, useRef } from "react";

import { getCanvasDesign } from "@/components/canvas/designs";
import { ReelPreviewOverlay } from "@/components/canvas/ReelPreviewOverlay";
import {
  matrixToPercents,
  numberBadgeSize,
  percentsToMatrix,
  percentsToNumberMatrix,
  scaleBox,
  scaleNumber,
  ZOOM_FACTOR,
} from "@/lib/canvas-geometry";
import { isZoomInKey, isZoomKey, isEditableTarget } from "@/lib/canvas-keyboard";
import { isElementActiveAt } from "@/lib/element-visibility";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvas-store";
import {
  isArrowNode,
  isBoxNode,
  isNumberNode,
  type CanvasElement,
} from "@/types/canvas";

/** Higher track index paints first (back); track 0 is on top. */
function byTrackDescending(a: CanvasElement, b: CanvasElement) {
  return b.time.track - a.time.track;
}

export function Canvas({
  showReelPreview = false,
  exporting = false,
  width,
  height,
}: {
  showReelPreview?: boolean;
  exporting?: boolean;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const elements = useCanvasStore((state) => state.elements);
  const selectedId = useCanvasStore((state) => state.selectedId);
  const selectElement = useCanvasStore((state) => state.selectElement);
  const currentTime = useCanvasStore((state) => state.currentTime);
  const renderTheme = useCanvasStore((state) => state.renderTheme);
  const design = getCanvasDesign(renderTheme);

  const visible = useMemo(
    () =>
      [...elements]
        .filter((el) => isElementActiveAt(el.time, currentTime))
        .sort(byTrackDescending),
    [elements, currentTime],
  );
  const boxes = elements.filter(isBoxNode);
  const htmlNodes = visible.filter(
    (el): el is Extract<CanvasElement, { type: "box" | "number" }> =>
      isBoxNode(el) || isNumberNode(el),
  );
  const arrows = visible.filter(isArrowNode);
  const markerPrefix = exporting ? "export" : "preview";

  useEffect(() => {
    function resizeSelected(factor: number) {
      const { selectedId: id, elements: current, updateElement: update } =
        useCanvasStore.getState();

      if (!id) {
        return false;
      }

      const selected = current.find((element) => element.id === id);
      if (!selected || isArrowNode(selected)) {
        return false;
      }

      if (isBoxNode(selected)) {
        const rect = matrixToPercents(selected.matrix);
        const next = scaleBox(
          {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          },
          factor,
        );
        update(selected.id, {
          matrix: percentsToMatrix({
            left: next.x,
            top: next.y,
            width: next.width,
            height: next.height,
          }),
        });
        return true;
      }

      if (isNumberNode(selected)) {
        const rect = matrixToPercents(selected.matrix);
        const next = scaleNumber(
          { x: rect.left, y: rect.top, size: numberBadgeSize(selected) },
          factor,
        );
        update(selected.id, {
          size: next.size,
          matrix: percentsToNumberMatrix({
            left: next.x,
            top: next.y,
            width: rect.width,
            height: rect.height,
          }),
        });
        return true;
      }

      return false;
    }

    function handleWindowKeyDown(event: KeyboardEvent) {
      if (!selectedId || isEditableTarget(event.target) || !isZoomKey(event)) {
        return;
      }

      const factor = isZoomInKey(event) ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      if (!resizeSelected(factor)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    }

    function handleWindowWheel(event: WheelEvent) {
      // Chrome/macOS pinch is ctrlKey + wheel; ignore ordinary two-finger scroll.
      if (!event.ctrlKey || !selectedId || isEditableTarget(event.target)) {
        return;
      }

      const factor = Math.exp(-event.deltaY * 0.01);
      if (!resizeSelected(factor)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    window.addEventListener("wheel", handleWindowWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
      window.removeEventListener("wheel", handleWindowWheel);
    };
  }, [selectedId]);

  return (
    <div
      ref={canvasRef}
      data-render-theme={renderTheme}
      data-exporting={exporting ? "true" : undefined}
      className={cn(
        "relative shrink-0 overflow-hidden rounded-xl shadow-sm",
        design.frameClassName,
      )}
      style={{
        ...design.frameStyle(exporting),
        width,
        height,
      }}
      onClick={() => selectElement(null)}
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <defs>
          <design.Markers markerPrefix={markerPrefix} />
        </defs>

        {arrows.map((arrow) => (
          <design.Arrow
            key={arrow.id}
            arrow={arrow}
            boxes={boxes}
            selected={!exporting && arrow.id === selectedId}
            markerPrefix={markerPrefix}
          />
        ))}
      </svg>

      <div className="absolute inset-0">
        {htmlNodes.map((node) =>
          isBoxNode(node) ? (
            <design.Box
              key={node.id}
              node={node}
              selected={!exporting && node.id === selectedId}
              canvasRef={canvasRef}
            />
          ) : (
            <design.Number
              key={node.id}
              node={node}
              selected={!exporting && node.id === selectedId}
              canvasRef={canvasRef}
            />
          ),
        )}
      </div>
      {showReelPreview ? <ReelPreviewOverlay /> : null}
    </div>
  );
}
