import { forwardRef } from "react";
import { Minus, Music, Plus, X } from "lucide-react";

import {
  TIMELINE_RULER_HEIGHT,
  TRACK_ROW_HEIGHT,
} from "@/components/editor/timeline/lib/timeMath";
import { Button } from "@/components/ui/button";

interface TrackLabelsProps {
  trackCount: number;
  onDeleteTrack: (index: number) => void;
  onAddTrack: () => void;
  hasPreviewAudio?: boolean;
  onRemoveAudio?: () => void;
}

export const TrackLabels = forwardRef<HTMLDivElement, TrackLabelsProps>(
  function TrackLabels(
    { trackCount, onDeleteTrack, onAddTrack, hasPreviewAudio, onRemoveAudio },
    ref,
  ) {
    return (
      <div className="z-20 flex h-full min-h-0 w-24 shrink-0 flex-col border-r border-border bg-card">
        <div
          ref={ref}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-hidden"
        >
          <div
            className="sticky top-0 z-10 shrink-0 border-b border-border bg-card"
            style={{ height: TIMELINE_RULER_HEIGHT }}
          />
          {hasPreviewAudio ? (
            <div
              aria-label="Audio"
              className="box-border flex shrink-0 items-center justify-between gap-1 border-b border-border/80 px-2"
              style={{ height: TRACK_ROW_HEIGHT }}
            >
              <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                <Music aria-hidden className="size-3 shrink-0" />
                Audio
              </span>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Remove audio"
                className="text-muted-foreground hover:bg-transparent hover:text-foreground"
                onClick={onRemoveAudio}
              >
                <X />
              </Button>
            </div>
          ) : null}
          {Array.from({ length: trackCount }, (_, track) => (
            <div
              key={track}
              className="group/row box-border flex shrink-0 items-center justify-between gap-1 border-b border-border/80 px-2"
              style={{ height: TRACK_ROW_HEIGHT }}
            >
              <span className="truncate text-[11px] text-muted-foreground">
                Track {track + 1}
              </span>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`Delete track ${track + 1}`}
                disabled={trackCount <= 1}
                className="text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-transparent hover:text-red-500 disabled:opacity-0"
                onClick={() => onDeleteTrack(track)}
              >
                <Minus />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center justify-center border-t border-border py-0.5">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Add track"
            onClick={onAddTrack}
          >
            <Plus />
          </Button>
        </div>
      </div>
    );
  },
);
