import { Pause, Play } from "lucide-react";

import { formatRulerLabel } from "@/components/editor/timeline/lib/timeMath";
import { Button } from "@/components/ui/button";
import { useCanvasStore } from "@/stores/canvas-store";

export function PlaybackBar() {
  const currentTime = useCanvasStore((state) => state.currentTime);
  const duration = useCanvasStore((state) => state.duration);
  const isPlaying = useCanvasStore((state) => state.isPlaying);
  const togglePlayback = useCanvasStore((state) => state.togglePlayback);

  return (
    <div className="flex shrink-0 items-center justify-center gap-2 px-2 py-1.5">
      <Button
        type="button"
        size="icon-xs"
        variant="outline"
        aria-label={isPlaying ? "Pause" : "Play"}
        aria-pressed={isPlaying}
        onClick={togglePlayback}
      >
        {isPlaying ? <Pause /> : <Play />}
      </Button>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatRulerLabel(currentTime)} / {formatRulerLabel(duration)}
      </span>
    </div>
  );
}
