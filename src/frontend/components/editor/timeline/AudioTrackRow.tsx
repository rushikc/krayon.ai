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
      className="relative box-border shrink-0 border-b border-border/60 bg-muted/10"
      style={{ height: TRACK_ROW_HEIGHT }}
    >
      <div
        title={clip.name}
        className="absolute inset-y-0.5 left-0 overflow-hidden rounded border border-[var(--timeline-audio-border)] bg-[var(--timeline-audio-bg)] px-1.5 text-[11px] font-medium text-[var(--timeline-audio-fg)]"
        style={{ width }}
      >
        <span className="flex h-full items-center truncate">{clip.name}</span>
      </div>
    </div>
  );
}
