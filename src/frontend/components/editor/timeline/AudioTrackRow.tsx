import {
  segmentWidthPercent,
  TRACK_ROW_HEIGHT,
} from "@/components/editor/timeline/lib/timeMath";
import type { PreviewAudioClip } from "@/lib/preview-audio";

interface AudioTrackRowProps {
  clip: PreviewAudioClip;
  duration: number;
}

export function AudioTrackRow({ clip, duration }: AudioTrackRowProps) {
  const width = segmentWidthPercent(
    0,
    Math.min(clip.duration, duration),
    duration,
  );

  return (
    <div
      aria-label="Preview audio"
      className="relative box-border shrink-0 border-b border-border/80 bg-muted/20"
      style={{ height: TRACK_ROW_HEIGHT }}
    >
      <div
        title={clip.name}
        className="absolute inset-y-1 left-0 overflow-hidden rounded-md border border-black/10 bg-emerald-700/90 px-2 text-xs font-medium text-white"
        style={{ width }}
      >
        <span className="flex h-full items-center truncate">{clip.name}</span>
      </div>
    </div>
  );
}
