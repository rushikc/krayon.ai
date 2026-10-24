import { useMemo } from "react";

import {
  buildRulerTicks,
  formatRulerLabel,
  TIMELINE_RULER_HEIGHT,
  timeToPercent,
} from "@/components/editor/timeline/lib/timeMath";
import { cn } from "@/lib/utils";

function rulerLabelAlignClass(time: number, safeDuration: number): string {
  if (time <= 0) {
    return "translate-x-0";
  }
  if (time >= safeDuration - 0.001) {
    return "-translate-x-full";
  }
  return "-translate-x-1/2";
}

interface TimelineRulerProps {
  duration: number;
}

export function TimelineRuler({ duration }: TimelineRulerProps) {
  const ticks = useMemo(() => buildRulerTicks(duration), [duration]);

  return (
    <div
      className="sticky top-0 z-10 border-b border-border bg-card"
      style={{ height: TIMELINE_RULER_HEIGHT }}
    >
      {ticks.map((tick) => (
        <div
          key={`${tick.time}-${tick.major ? "m" : "n"}`}
          className="absolute top-0 bottom-0"
          style={{ left: timeToPercent(tick.time, duration) }}
        >
          {tick.major ? (
            <span
              className={cn(
                "absolute top-1/2 -translate-y-1/2 font-mono text-[10px] tabular-nums text-muted-foreground",
                rulerLabelAlignClass(tick.time, duration),
              )}
            >
              {formatRulerLabel(tick.time)}
            </span>
          ) : null}
          <span
            className="absolute bottom-0 block w-px bg-border"
            style={{ height: tick.major ? 8 : 4 }}
          />
        </div>
      ))}
    </div>
  );
}
