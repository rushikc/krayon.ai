import { timeToPercent } from "@/components/editor/timeline/lib/timeMath";
import { cn } from "@/lib/utils";

interface PlayheadProps {
  currentTime: number;
  duration: number;
  scrubbing: boolean;
}

export function Playhead({ currentTime, duration, scrubbing }: PlayheadProps) {
  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-primary"
      style={{ left: timeToPercent(currentTime, duration) }}
    >
      <div
        className={cn(
          "absolute left-1/2 top-0.5 size-2 -translate-x-1/2 rounded-full border-2 border-background bg-primary transition-transform",
          scrubbing ? "scale-110" : "scale-100",
        )}
      />
    </div>
  );
}
