import { useEffect, useRef, useState } from "react";

import type { StudioClip } from "@/lib/api/studio-client";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

export type EditWaveSegment = {
  clipId: string;
  status: StudioClip["status"];
  active: boolean;
  duration: number;
  silenceBefore: number;
  silenceAfter: number;
  peaks: number[];
  sourceStart: number;
  sourceEnd: number;
  label: string;
  draftSilence?: boolean;
};

function speechColor(status: StudioClip["status"], active: boolean): string {
  if (status === "selected") return active ? "rgb(29 78 216)" : "rgb(37 99 235)";
  return active ? "rgb(185 28 28)" : "rgb(248 113 113 / 0.55)";
}

export function StudioEditWaveform({
  segments,
  currentTime,
  cuts,
  onSeek,
  onSelectClip,
  onRemoveCut,
}: {
  segments: EditWaveSegment[];
  currentTime: number;
  cuts: number[];
  onSeek: (time: number) => void;
  onSelectClip: (clipId: string) => void;
  onRemoveCut?: (at: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const playheadElRef = useRef<HTMLDivElement>(null);
  const total = Math.max(0.01, segments.reduce((sum, item) => sum + item.duration, 0));
  const [hoverX, setHoverX] = useState<number | null>(null);

  function setPlayheadTime(time: number) {
    const wrap = wrapRef.current;
    const head = playheadElRef.current;
    if (!wrap || !head) return;
    const x = (Math.max(0, time) / total) * wrap.clientWidth;
    head.style.transform = `translateX(${x}px)`;
  }

  useEffect(() => {
    setPlayheadTime(currentTime);
  }, [currentTime, total]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    function paint() {
      const node = canvasRef.current;
      const box = wrapRef.current;
      if (!node || !box) return;
      const cssWidth = Math.max(1, box.clientWidth);
      const cssHeight = 180;
      const dpr = window.devicePixelRatio || 1;
      node.width = Math.floor(cssWidth * dpr);
      node.height = Math.floor(cssHeight * dpr);
      node.style.width = `${cssWidth}px`;
      node.style.height = `${cssHeight}px`;
      const ctx = node.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      const mid = cssHeight / 2;
      let cursor = 0;
      for (const segment of segments) {
        const width = (segment.duration / total) * cssWidth;
        const x0 = (cursor / total) * cssWidth;
        const beforeW = (segment.silenceBefore / total) * cssWidth;
        const afterW = (segment.silenceAfter / total) * cssWidth;
        const speechW = Math.max(1, width - beforeW - afterW);
        ctx.fillStyle = segment.draftSilence ? "rgb(167 139 250 / 0.35)" : "rgb(148 163 184 / 0.12)";
        if (beforeW > 0) ctx.fillRect(x0, 0, beforeW, cssHeight);
        if (afterW > 0) ctx.fillRect(x0 + width - afterW, 0, afterW, cssHeight);
        ctx.fillStyle = speechColor(segment.status, segment.active);
        const buckets = Math.max(1, Math.floor(segment.peaks.length / 2));
        const barW = speechW / buckets;
        for (let index = 0; index < buckets; index += 1) {
          const lo = segment.peaks[index * 2] ?? 0;
          const hi = segment.peaks[index * 2 + 1] ?? 0;
          const mag = Math.max(Math.abs(lo), Math.abs(hi), 0.02);
          const h = mag * (mid - 10);
          ctx.fillRect(x0 + beforeW + index * barW, mid - h, Math.max(1, barW - 0.3), h * 2);
        }
        ctx.fillStyle = "rgb(226 232 240)";
        ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
        if (width > 48) ctx.fillText(segment.label, x0 + 6, 16);
        ctx.fillStyle = "rgb(15 23 42)";
        ctx.fillRect(x0 + width - 2, 8, 2, cssHeight - 16);
        if (segment.active) {
          for (const cut of cuts) {
            if (cut <= segment.sourceStart || cut >= segment.sourceEnd) continue;
            const speechDur = Math.max(0.01, segment.sourceEnd - segment.sourceStart);
            const local = segment.silenceBefore + ((cut - segment.sourceStart) / speechDur) * (segment.duration - segment.silenceBefore - segment.silenceAfter);
            const x = ((cursor + local) / total) * cssWidth;
            ctx.strokeStyle = "rgb(251 191 36)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, cssHeight);
            ctx.stroke();
          }
        }
        cursor += segment.duration;
      }
      setPlayheadTime(currentTime);
    }

    paint();
    const observer = new ResizeObserver(() => paint());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [segments, cuts, total, currentTime]);

  function timeAt(clientX: number): number {
    const box = wrapRef.current;
    if (!box) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - box.getBoundingClientRect().left) / box.clientWidth));
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

  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      data-testid="studio-edit-waveform"
      onPointerDown={(event) => {
        const time = timeAt(event.clientX);
        const id = clipAt(time);
        if (id) onSelectClip(id);
        onSeek(time);
      }}
      onMouseMove={(event) => setHoverX(event.nativeEvent.offsetX)}
      onMouseLeave={() => setHoverX(null)}
    >
      <canvas ref={canvasRef} className="block w-full cursor-pointer" height={180} />
      <div
        ref={playheadElRef}
        data-testid="waveform-playhead"
        className="pointer-events-none absolute top-0 z-[5] h-[180px] w-0.5 bg-foreground"
        style={{ transform: "translateX(0px)" }}
      />
      {hoverX != null ? (
        <div className="pointer-events-none absolute top-0 h-[180px] w-px bg-white/70" style={{ left: hoverX }} />
      ) : null}
      {segments.map((segment, index) => {
        let start = 0;
        for (let i = 0; i < index; i += 1) start += segments[i]!.duration;
        if (!segment.active) return null;
        return cuts
          .filter((cut) => cut > segment.sourceStart && cut < segment.sourceEnd)
          .map((cut) => {
            const speechDur = Math.max(0.01, segment.sourceEnd - segment.sourceStart);
            const local =
              segment.silenceBefore +
              ((cut - segment.sourceStart) / speechDur) * (segment.duration - segment.silenceBefore - segment.silenceAfter);
            const left = ((start + local) / total) * 100;
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
          });
      })}
    </div>
  );
}
