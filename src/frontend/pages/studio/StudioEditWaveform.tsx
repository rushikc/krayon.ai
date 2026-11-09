import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { StudioClip } from "@/lib/api/studio-client";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

export type EditWaveSegment = {
  clipId: string;
  status: StudioClip["status"];
  duration: number;
  silenceBefore: number;
  silenceAfter: number;
  peaks: number[];
  sourceStart: number;
  sourceEnd: number;
  label: string;
  draftSilence?: boolean;
};

export const EDIT_ZOOM_MIN = 1;
export const EDIT_ZOOM_MAX = 16;
export const EDIT_ZOOM_STEP = 0.1;

export function followPlayheadScrollLeft(playheadX: number, view: number, contentWidth: number): number {
  const inset = Math.min(Math.max(view * 0.35, 48), Math.max(0, view - 8));
  const maxScroll = Math.max(0, contentWidth - view);
  return Math.min(maxScroll, Math.max(0, playheadX - inset));
}

export function nextEditZoom(current: number, direction: 1 | -1): number {
  const next = Math.round((current + direction * EDIT_ZOOM_STEP) * 10) / 10;
  return Math.min(EDIT_ZOOM_MAX, Math.max(EDIT_ZOOM_MIN, next));
}

export function zoomPreserveScrollLeft({
  playing,
  playheadXOld,
  playheadXNew,
  oldScroll,
  view,
  newWidth,
  oldWidth,
}: {
  playing: boolean;
  playheadXOld: number;
  playheadXNew: number;
  oldScroll: number;
  view: number;
  newWidth: number;
  oldWidth: number;
}): number {
  const maxScroll = Math.max(0, newWidth - view);
  if (playing) return followPlayheadScrollLeft(playheadXNew, view, newWidth);
  const inView = playheadXOld >= oldScroll && playheadXOld <= oldScroll + view;
  if (inView) return Math.min(maxScroll, Math.max(0, playheadXNew - (playheadXOld - oldScroll)));
  const centerRatio = oldWidth > 0 ? (oldScroll + view / 2) / oldWidth : 0;
  return Math.min(maxScroll, Math.max(0, centerRatio * newWidth - view / 2));
}

function speechColor(status: StudioClip["status"]): string {
  if (status === "selected") return "rgb(37 99 235)";
  return "rgb(248 113 113 / 0.55)";
}

function activeTint(status: StudioClip["status"]): string {
  return status === "selected" ? "rgb(59 130 246 / 0.18)" : "rgb(239 68 68 / 0.16)";
}

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 8;

export function StudioEditWaveform({
  segments,
  currentTime,
  cuts,
  zoom,
  playing,
  selectedClipId,
  getMediaTime,
  onPlayingFrame,
  onZoom,
  onWavePointerDown,
  onWavePointerMove,
  onWavePointerUp,
  onRemoveCut,
  onTogglePlay,
  onUserPause,
  isScrubbing,
}: {
  segments: EditWaveSegment[];
  currentTime: number;
  cuts: number[];
  zoom: number;
  playing?: boolean;
  selectedClipId?: string | null;
  getMediaTime?: () => number;
  onPlayingFrame?: (time: number) => void;
  onZoom: (next: number) => void;
  onWavePointerDown: (clipId: string, time: number) => void;
  onWavePointerMove: (time: number) => void;
  onWavePointerUp: () => void;
  onRemoveCut?: (at: number) => void;
  onTogglePlay?: () => void;
  onUserPause?: () => void;
  isScrubbing?: () => boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadElRef = useRef<HTMLDivElement>(null);
  const total = Math.max(0.01, segments.reduce((sum, item) => sum + item.duration, 0));
  const [visibleWidth, setVisibleWidth] = useState(1);
  const [visibleHeight, setVisibleHeight] = useState(1);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const cssWidth = Math.max(1, visibleWidth * zoom);
  const cssHeight = Math.max(1, visibleHeight);
  const zoomRef = useRef(zoom);
  const prevZoomRef = useRef(zoom);
  const timeRef = useRef(currentTime);
  const getMediaTimeRef = useRef(getMediaTime);
  const onPlayingFrameRef = useRef(onPlayingFrame);
  const onZoomRef = useRef(onZoom);
  const onUserPauseRef = useRef(onUserPause);
  const playingRef = useRef(Boolean(playing));
  const programmaticFollowRef = useRef(false);
  const backingRef = useRef({ w: 0, h: 0, dpr: 0 });
  const lastTapRef = useRef<{
    clipId: string;
    time: number;
    x: number;
    y: number;
    pointerType: string;
    dragged: boolean;
  } | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number; id: number; type: string } | null>(null);
  const panningRef = useRef(false);
  zoomRef.current = zoom;
  timeRef.current = currentTime;
  getMediaTimeRef.current = getMediaTime;
  onPlayingFrameRef.current = onPlayingFrame;
  onZoomRef.current = onZoom;
  onUserPauseRef.current = onUserPause;
  playingRef.current = Boolean(playing);

  function setPlayheadTime(time: number) {
    const head = playheadElRef.current;
    if (!head) return;
    const x = (Math.max(0, time) / total) * cssWidth;
    head.style.transform = `translateX(${x}px)`;
  }

  function paintVisible() {
    const node = canvasRef.current;
    const scroller = scrollRef.current;
    if (!node || !scroller) return;
    const viewW = Math.max(1, scroller.clientWidth);
    const viewH = Math.max(1, scroller.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    const pixelW = Math.floor(viewW * dpr);
    const pixelH = Math.floor(viewH * dpr);
    const backing = backingRef.current;
    if (backing.w !== pixelW || backing.h !== pixelH || backing.dpr !== dpr) {
      node.width = pixelW;
      node.height = pixelH;
      backing.w = pixelW;
      backing.h = pixelH;
      backing.dpr = dpr;
    }
    node.style.width = `${viewW}px`;
    node.style.height = `${viewH}px`;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);
    const scrollLeft = scroller.scrollLeft;
    const viewStart = scrollLeft;
    const viewEnd = scrollLeft + viewW;
    const mid = viewH / 2;
    let cursor = 0;
    for (let segIndex = 0; segIndex < segments.length; segIndex += 1) {
      const segment = segments[segIndex]!;
      const width = (segment.duration / total) * cssWidth;
      const x0 = (cursor / total) * cssWidth;
      const x1 = x0 + width;
      cursor += segment.duration;
      if (x1 < viewStart - 2 || x0 > viewEnd + 2) continue;
      const localX0 = x0 - scrollLeft;
      const beforeW = (segment.silenceBefore / total) * cssWidth;
      const afterW = (segment.silenceAfter / total) * cssWidth;
      const speechW = Math.max(1, width - beforeW - afterW);
      ctx.fillStyle = segment.draftSilence ? "rgb(167 139 250 / 0.35)" : "rgb(148 163 184 / 0.12)";
      if (beforeW > 0) ctx.fillRect(localX0, 0, beforeW, viewH);
      if (afterW > 0) ctx.fillRect(localX0 + width - afterW, 0, afterW, viewH);
      ctx.fillStyle = speechColor(segment.status);
      const buckets = Math.max(1, Math.floor(segment.peaks.length / 2));
      const barW = speechW / buckets;
      for (let index = 0; index < buckets; index += 1) {
        const barX = localX0 + beforeW + index * barW;
        if (barX + barW < 0 || barX > viewW) continue;
        const lo = segment.peaks[index * 2] ?? 0;
        const hi = segment.peaks[index * 2 + 1] ?? 0;
        const mag = Math.max(Math.abs(lo), Math.abs(hi), 0.02);
        const h = mag * Math.max(8, mid - 10);
        ctx.fillRect(barX, mid - h, Math.max(1, barW - 0.3), h * 2);
      }
      ctx.fillStyle = "rgb(226 232 240)";
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      if (width > 48) {
        const next = segments[segIndex + 1];
        const nextX0 = next ? x0 + width : cssWidth;
        const labelWidth = ctx.measureText(segment.label).width;
        if (x0 + 6 + labelWidth < nextX0) ctx.fillText(segment.label, localX0 + 6, 16);
      }
      ctx.fillStyle = "rgb(226 232 240 / 0.35)";
      ctx.fillRect(localX0 + width - 2, 8, 2, viewH - 16);
    }
  }

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    function measure() {
      const node = scrollRef.current;
      if (!node) return;
      setVisibleWidth(Math.max(1, node.clientWidth));
      setVisibleHeight(Math.max(1, node.clientHeight));
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (playing) return;
    setPlayheadTime(currentTime);
  }, [playing, currentTime, cssWidth, total]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const prevZoom = prevZoomRef.current;
    const view = scroller.clientWidth;
    const t = getMediaTimeRef.current?.() ?? timeRef.current;
    const oldWidth = Math.max(1, visibleWidth * prevZoom);
    const oldX = (Math.max(0, t) / total) * oldWidth;
    const newX = (Math.max(0, t) / total) * cssWidth;
    if (prevZoom !== zoom) {
      programmaticFollowRef.current = true;
      scroller.scrollLeft = zoomPreserveScrollLeft({
        playing: playingRef.current,
        playheadXOld: oldX,
        playheadXNew: newX,
        oldScroll: scroller.scrollLeft,
        view,
        newWidth: cssWidth,
        oldWidth,
      });
      programmaticFollowRef.current = false;
    }
    prevZoomRef.current = zoom;
    paintVisible();
  }, [zoom, cssWidth, cssHeight, total, segments, visibleWidth]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    function onWheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        onZoomRef.current(nextEditZoom(zoomRef.current, event.deltaY < 0 ? 1 : -1));
        return;
      }
      if (Math.abs(event.deltaX) > 0.5) onUserPauseRef.current?.();
    }
    function onScroll() {
      if (!programmaticFollowRef.current && playingRef.current) onUserPauseRef.current?.();
      paintVisible();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.target !== scroller) return;
      onUserPauseRef.current?.();
    }
    scroller.addEventListener("wheel", onWheel, { passive: false });
    scroller.addEventListener("scroll", onScroll);
    scroller.addEventListener("keydown", onKey);
    return () => {
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!playing) {
      setPlayheadTime(getMediaTimeRef.current?.() ?? timeRef.current);
      return;
    }
    let frame = 0;
    function tick() {
      const t = getMediaTimeRef.current?.() ?? timeRef.current;
      setPlayheadTime(t);
      const scroller = scrollRef.current;
      if (scroller) {
        const x = (Math.max(0, t) / total) * cssWidth;
        programmaticFollowRef.current = true;
        scroller.scrollLeft = followPlayheadScrollLeft(x, scroller.clientWidth, cssWidth);
        programmaticFollowRef.current = false;
      }
      paintVisible();
      onPlayingFrameRef.current?.(t);
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setPlayheadTime(getMediaTimeRef.current?.() ?? timeRef.current);
    };
  }, [playing, cssWidth, total]);

  function timeAt(clientX: number): number {
    const box = wrapRef.current;
    if (!box) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - box.getBoundingClientRect().left) / cssWidth));
    return ratio * total;
  }

  function clipAt(time: number): string | null {
    let cursor = 0;
    for (const segment of segments) {
      if (time < cursor + segment.duration) return segment.clipId;
      cursor += segment.duration;
    }
    return segments.at(-1)?.clipId ?? null;
  }

  function isDoubleTap(clipId: string, event: ReactPointerEvent<HTMLDivElement>): boolean {
    const last = lastTapRef.current;
    if (!last) return false;
    if (last.dragged) return false;
    if (last.clipId !== clipId) return false;
    if (event.pointerType !== last.pointerType) return false;
    if (Date.now() - last.time > DOUBLE_TAP_MS) return false;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    return Math.hypot(dx, dy) <= DOUBLE_TAP_PX;
  }

  let activeStart = 0;
  let activeSegment: EditWaveSegment | undefined;
  {
    let cursor = 0;
    for (const segment of segments) {
      if (segment.clipId === selectedClipId) {
        activeSegment = segment;
        activeStart = cursor;
        break;
      }
      cursor += segment.duration;
    }
  }
  const activeLeft = activeSegment ? (activeStart / total) * 100 : 0;
  const activeWidth = activeSegment ? (activeSegment.duration / total) * 100 : 0;

  return (
    <div
      ref={scrollRef}
      className={cn(
        "min-h-0 w-full flex-1 overflow-x-auto",
        zoom > 1 ? "scrollbar-thin" : "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
      data-testid="studio-edit-wave-scroll"
      tabIndex={-1}
    >
      <div
        ref={wrapRef}
        className="relative h-full"
        style={{ width: cssWidth }}
        data-testid="studio-edit-waveform"
        data-zoom={zoom}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          const time = timeAt(event.clientX);
          const id = clipAt(time);
          if (!id) return;
          if (event.pointerType === "mouse" && lastTapRef.current?.pointerType === "touch" && Date.now() - lastTapRef.current.time < 700) {
            return;
          }
          if (isDoubleTap(id, event)) {
            lastTapRef.current = null;
            onTogglePlay?.();
            return;
          }
          pointerDownRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId, type: event.pointerType };
          panningRef.current = false;
          lastTapRef.current = {
            clipId: id,
            time: Date.now(),
            x: event.clientX,
            y: event.clientY,
            pointerType: event.pointerType,
            dragged: false,
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
          onWavePointerDown(id, time);
        }}
        onPointerMove={(event) => {
          setHoverX(event.clientX - (wrapRef.current?.getBoundingClientRect().left ?? 0));
          if (!event.buttons || !pointerDownRef.current) return;
          const dx = event.clientX - pointerDownRef.current.x;
          if (isScrubbing?.()) {
            onWavePointerMove(timeAt(event.clientX));
            return;
          }
          if (Math.abs(dx) > DOUBLE_TAP_PX) {
            if (lastTapRef.current) lastTapRef.current.dragged = true;
            if (playing) {
              panningRef.current = true;
              onUserPause?.();
              const scroller = scrollRef.current;
              if (scroller) scroller.scrollLeft -= event.movementX;
            }
          }
        }}
        onPointerUp={() => {
          pointerDownRef.current = null;
          panningRef.current = false;
          onWavePointerUp();
        }}
        onPointerCancel={() => {
          pointerDownRef.current = null;
          if (lastTapRef.current) lastTapRef.current.dragged = true;
          onWavePointerUp();
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        <canvas ref={canvasRef} className="sticky left-0 top-0 z-0 block cursor-pointer" />
        {activeSegment ? (
          <div
            data-testid="edit-active-clip"
            className="pointer-events-none absolute top-0 z-[1]"
            style={{
              left: `${activeLeft}%`,
              width: `${activeWidth}%`,
              height: cssHeight,
              background: activeTint(activeSegment.status),
            }}
          />
        ) : null}
        <div
          ref={playheadElRef}
          data-testid="waveform-playhead"
          className="pointer-events-none absolute top-0 z-[5] w-0.5 bg-foreground"
          style={{ transform: "translateX(0px)", height: cssHeight }}
        />
        {hoverX != null ? (
          <div
            className="pointer-events-none absolute top-0 z-[4] w-px bg-white/70"
            style={{ left: hoverX, height: cssHeight }}
          />
        ) : null}
        {activeSegment
          ? cuts
              .filter((cut) => cut > activeSegment.sourceStart && cut < activeSegment.sourceEnd)
              .map((cut) => {
                const speechDur = Math.max(0.01, activeSegment.sourceEnd - activeSegment.sourceStart);
                const local =
                  activeSegment.silenceBefore +
                  ((cut - activeSegment.sourceStart) / speechDur) *
                    (activeSegment.duration - activeSegment.silenceBefore - activeSegment.silenceAfter);
                const left = ((activeStart + local) / total) * 100;
                return (
                  <button
                    key={cut}
                    type="button"
                    className={cn("absolute z-10 -translate-x-1/2 rounded bg-amber-500 px-1 text-[10px] text-black", "top-1")}
                    style={{ left: `${left}%` }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveCut?.(cut);
                    }}
                  >
                    {formatTimestamp(cut)} ×
                  </button>
                );
              })
          : null}
      </div>
    </div>
  );
}
