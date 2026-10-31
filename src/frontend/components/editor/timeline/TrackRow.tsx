import { TRACK_ROW_HEIGHT } from "@/components/editor/timeline/lib/timeMath";
import type { CanvasElement } from "@/types/canvas";

import type { useSegmentDrag } from "./hooks/useSegmentDrag";
import type { useSegmentResize } from "./hooks/useSegmentResize";
import { SegmentBlock } from "./SegmentBlock";

type DragHandlers = ReturnType<typeof useSegmentDrag>;
type ResizeHandlers = ReturnType<typeof useSegmentResize>;

interface TrackRowProps {
  track: number;
  elements: CanvasElement[];
  duration: number;
  selectedId: string | null;
  drag: DragHandlers;
  resize: ResizeHandlers;
  onEdit?: (id: string) => void;
}

export function TrackRow({
  track,
  elements,
  duration,
  selectedId,
  drag,
  resize,
  onEdit,
}: TrackRowProps) {
  const trackElements = elements.filter((el) => el.time.track === track);

  return (
    <div
      className="relative box-border shrink-0 border-b border-border/60 bg-muted/10"
      style={{ height: TRACK_ROW_HEIGHT }}
    >
      {trackElements.map((element) => (
        <SegmentBlock
          key={element.id}
          element={element}
          duration={duration}
          selected={element.id === selectedId}
          drag={drag}
          resize={resize}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
