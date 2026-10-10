import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  pixelToTime,
  TRACK_ROW_HEIGHT,
} from "@/components/editor/timeline/lib/timeMath";
import type { PreviewAudioClip } from "@/lib/preview-audio";
import type { CanvasElement } from "@/types/canvas";

import { AudioTrackRow } from "./AudioTrackRow";
import { useSegmentDrag } from "./hooks/useSegmentDrag";
import { useSegmentResize } from "./hooks/useSegmentResize";
import { Playhead } from "./Playhead";
import { TimelineRuler } from "./TimelineRuler";
import { TrackLabels } from "./TrackLabels";
import { TrackRow } from "./TrackRow";

const MIN_PX_PER_SECOND = 8;

export interface TimelineProps {
  elements: CanvasElement[];
  duration: number;
  currentTime: number;
  trackCount: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (elements: CanvasElement[]) => void;
  onSeek: (time: number) => void;
  onAddTrack: () => void;
  onDeleteTrack: (index: number) => void;
  previewAudio?: PreviewAudioClip | null;
  onRemoveAudio?: () => void;
}

export function Timeline({
  elements,
  duration,
  currentTime,
  trackCount,
  selectedId,
  onSelect,
  onChange,
  onSeek,
  onAddTrack,
  onDeleteTrack,
  previewAudio = null,
  onRemoveAudio,
}: TimelineProps) {
  const labelsRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(800);

  const safeDuration = Math.max(duration, 1);

  const timelineWidth = Math.max(
    viewportWidth,
    safeDuration * MIN_PX_PER_SECOND,
  );
  const pxPerSecond = timelineWidth / safeDuration;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const update = () => setViewportWidth(el.clientWidth);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const syncLabelScroll = useCallback(() => {
    const labels = labelsRef.current;
    const tracks = scrollRef.current;
    if (!labels || !tracks) {
      return;
    }
    labels.scrollTop = tracks.scrollTop;
  }, []);

  const commitTime = useCallback(
    (id: string, next: { start: number; end: number; track: number }) => {
      onChange(
        elements.map((el) =>
          el.id === id
            ? {
                ...el,
                time: {
                  start: next.start,
                  end: next.end,
                  track: next.track,
                },
              }
            : el,
        ),
      );
    },
    [elements, onChange],
  );

  const drag = useSegmentDrag({
    elements,
    duration: safeDuration,
    pxPerSecond,
    trackCount,
    onSelect,
    onCommit: commitTime,
  });

  const resize = useSegmentResize({
    elements,
    duration: safeDuration,
    pxPerSecond,
    onSelect,
    onCommit: commitTime,
  });

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const time = pixelToTime(
        clientX,
        el.scrollLeft,
        rect.left,
        timelineWidth,
        safeDuration,
      );
      onSeek(time);
    },
    [onSeek, safeDuration, timelineWidth],
  );

  const startScrub = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        (event.target as HTMLElement).closest(
          "[data-timeline-interactive='true']",
        )
      ) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      setScrubbing(true);
      seekFromClientX(event.clientX);
    },
    [seekFromClientX],
  );

  const continueScrub = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!scrubbing) {
        return;
      }
      seekFromClientX(event.clientX);
    },
    [scrubbing, seekFromClientX],
  );

  const stopScrub = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setScrubbing(false);
  }, []);

  return (
    <div
      data-timeline-root
      tabIndex={0}
      className="flex h-full min-h-0 overflow-hidden bg-card outline-none"
      style={
        {
          "--track-row-height": `${TRACK_ROW_HEIGHT}px`,
        } as CSSProperties
      }
      onPointerDown={(event) => {
        event.currentTarget.focus();
      }}
    >
      <TrackLabels
        ref={labelsRef}
        trackCount={trackCount}
        onAddTrack={onAddTrack}
        onDeleteTrack={onDeleteTrack}
        hasPreviewAudio={Boolean(previewAudio)}
        onRemoveAudio={onRemoveAudio}
      />

      <div
        ref={scrollRef}
        className="relative min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto"
        onScroll={syncLabelScroll}
        onPointerDown={startScrub}
        onPointerMove={continueScrub}
        onPointerUp={stopScrub}
        onPointerCancel={stopScrub}
      >
        <div className="relative" style={{ width: timelineWidth }}>
          <TimelineRuler duration={safeDuration} />

          <div className="relative">
            {previewAudio ? (
              <AudioTrackRow clip={previewAudio} duration={safeDuration} />
            ) : null}
            {Array.from({ length: trackCount }, (_, track) => (
              <TrackRow
                key={track}
                track={track}
                elements={elements}
                duration={safeDuration}
                selectedId={selectedId}
                drag={drag}
                resize={resize}
              />
            ))}
          </div>

          <Playhead
            currentTime={currentTime}
            duration={safeDuration}
            scrubbing={scrubbing}
          />
        </div>
      </div>
    </div>
  );
}
