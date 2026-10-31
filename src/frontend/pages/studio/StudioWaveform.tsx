import { useEffect, useRef, useState } from "react";

import { formatTimestamp } from "@/lib/format";
import { sourceToPlayhead, wavOrigin } from "@/lib/studio-clip";
import { cn } from "@/lib/utils";

function formatTick(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function StudioWaveform({
  peaks,
  duration,
  currentTime,
  editing,
  cuts,
  sourceStart,
  sourceEnd,
  pad,
  onSeek,
  onRemoveCut,
}: {
  peaks: number[];
  duration: number;
  currentTime: number;
  editing: boolean;
  cuts: number[];
  sourceStart: number;
  sourceEnd: number;
  pad: number;
  onSeek: (playhead: number) => void;
  onRemoveCut?: (at: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const dragging = useRef(false);

  const origin = wavOrigin(sourceStart, pad);
  const widthDuration = duration || Math.max(0.01, sourceEnd + pad - origin);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    function paint() {
      const node = canvasRef.current;
      const box = wrapRef.current;
      if (!node || !box) return;
      const cssWidth = Math.max(1, box.clientWidth);
      const cssHeight = 120;
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
      const buckets = Math.max(1, Math.floor(peaks.length / 2));
      const barW = cssWidth / buckets;
      ctx.fillStyle = editing ? "rgb(59 130 246)" : "rgb(148 163 184)";
      for (let index = 0; index < buckets; index += 1) {
        const lo = peaks[index * 2] ?? 0;
        const hi = peaks[index * 2 + 1] ?? 0;
        const mag = Math.max(Math.abs(lo), Math.abs(hi), 0.02);
        const h = mag * (mid - 6);
        ctx.fillRect(index * barW, mid - h, Math.max(1, barW - 0.4), h * 2);
      }
      const bounds = [sourceStart, ...[...cuts].sort((a, b) => a - b), sourceEnd];
      if (editing && bounds.length > 2) {
        ctx.globalAlpha = 0.12;
        for (let index = 0; index < bounds.length - 1; index += 1) {
          const left = (sourceToPlayhead(bounds[index]!, sourceStart, pad) / widthDuration) * cssWidth;
          const right = (sourceToPlayhead(bounds[index + 1]!, sourceStart, pad) / widthDuration) * cssWidth;
          ctx.fillStyle = index % 2 === 0 ? "rgb(59 130 246)" : "rgb(37 99 235)";
          ctx.fillRect(left, 0, Math.max(1, right - left), cssHeight);
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = editing ? "rgb(191 219 254)" : "rgb(226 232 240)";
        ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
        for (let index = 0; index < bounds.length - 1; index += 1) {
          const left = (sourceToPlayhead(bounds[index]!, sourceStart, pad) / widthDuration) * cssWidth;
          ctx.fillText(`Part ${index + 1}`, left + 6, 14);
        }
      }
      ctx.strokeStyle = "rgb(248 250 252)";
      ctx.lineWidth = 2;
      const playX = ((Number.isFinite(currentTime) ? currentTime : 0) / widthDuration) * cssWidth;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, cssHeight);
      ctx.stroke();
      ctx.fillStyle = "rgb(248 250 252)";
      for (const cut of cuts) {
        const x = (sourceToPlayhead(cut, sourceStart, pad) / widthDuration) * cssWidth;
        ctx.strokeStyle = "rgb(251 191 36)";
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cssHeight);
        ctx.stroke();
      }
    }

    paint();
    const observer = new ResizeObserver(() => paint());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [peaks, duration, currentTime, editing, cuts, sourceStart, sourceEnd, pad, widthDuration]);

  function timeAt(clientX: number): number {
    const box = wrapRef.current;
    if (!box) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - box.getBoundingClientRect().left) / box.clientWidth));
    return ratio * widthDuration;
  }

  const ticks = [0, widthDuration / 4, widthDuration / 2, (widthDuration * 3) / 4, widthDuration];

  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      data-testid="studio-waveform"
      data-editing={editing ? "true" : "false"}
      onPointerDown={(event) => {
        dragging.current = true;
        onSeek(timeAt(event.clientX));
      }}
      onMouseDown={(event) => {
        dragging.current = true;
        onSeek(timeAt(event.clientX));
      }}
      onClick={(event) => onSeek(timeAt(event.clientX))}
      onMouseMove={(event) => {
        setHoverX(event.nativeEvent.offsetX);
        setHoverTime(timeAt(event.clientX));
        if (dragging.current) onSeek(timeAt(event.clientX));
      }}
      onMouseLeave={() => {
        dragging.current = false;
        setHoverX(null);
        setHoverTime(null);
      }}
      onMouseUp={() => {
        dragging.current = false;
      }}
    >
      <canvas
        ref={canvasRef}
        className="block w-full cursor-pointer"
        height={120}
        onPointerDown={(event) => {
          dragging.current = true;
          onSeek(timeAt(event.clientX));
        }}
        onClick={(event) => onSeek(timeAt(event.clientX))}
      />
      {hoverX != null ? (
        <div
          className="pointer-events-none absolute top-0 h-[120px] w-px bg-white/80"
          style={{ left: hoverX }}
        >
          <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] text-white">
            {formatTick(hoverTime ?? 0)}
          </span>
        </div>
      ) : null}
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        {ticks.map((tick, index) => (
          <span key={index}>{formatTick(tick)}</span>
        ))}
      </div>
      {editing
        ? cuts.map((cut) => {
            const left = (sourceToPlayhead(cut, sourceStart, pad) / widthDuration) * 100;
            return (
              <button
                key={cut}
                type="button"
                className={cn(
                  "absolute top-1 z-10 -translate-x-1/2 rounded bg-amber-500 px-1 text-[10px] text-black",
                )}
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
  );
}
