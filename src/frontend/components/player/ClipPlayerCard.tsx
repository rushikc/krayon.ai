import { Copy, Loader2, Pause, Play, Volume2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ClipPlayerCard({
  takeLabel,
  issueLabel,
  text,
  copyDisabled,
  onCopy,
  copyTooltip = "Copy sentence",
  copyAriaLabel = "Copy sentence",
  audio,
  srcReady,
  loading,
  currentTime,
  duration,
  isPlaying,
  onSeek,
  onTogglePlay,
  timeline,
  timelineHeader,
  timelineFooter,
  timelineCardClassName,
}: {
  takeLabel: string;
  issueLabel?: string | null;
  text?: string;
  copyDisabled?: boolean;
  onCopy: () => void;
  copyTooltip?: string;
  copyAriaLabel?: string;
  audio?: ReactNode;
  srcReady: boolean;
  loading?: boolean;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onSeek: (value: number) => void;
  onTogglePlay: () => void;
  timeline?: ReactNode;
  timelineHeader?: ReactNode;
  timelineFooter?: ReactNode;
  timelineCardClassName?: string;
}) {
  const scrubValue = Number.isFinite(currentTime) ? Math.min(currentTime, duration || 0) : 0;
  return (
    <div className="flex w-full max-w-3xl min-w-0 flex-col gap-4">
      <div
        className={cn(
          "rounded-xl border p-8",
          issueLabel ? "border-yellow-500/50 bg-yellow-500/10" : "border-border bg-card/50",
        )}
      >
        <div className="mb-4 flex items-center gap-3">
          <Volume2 className="size-8 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2 text-sm font-medium">
              <span className="whitespace-nowrap">{takeLabel}</span>
              {issueLabel && (
                <span className="text-[11px] font-medium uppercase tracking-wide text-yellow-400">{issueLabel}</span>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">{text}</p>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={copyAriaLabel}
                    disabled={copyDisabled}
                    onClick={onCopy}
                  />
                }
              >
                <Copy className="size-4" />
              </TooltipTrigger>
              <TooltipContent>{copyTooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {audio}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading clip audio…
          </div>
        ) : null}
      </div>

      <div className={cn("rounded-xl border border-border bg-card/60 p-4 backdrop-blur", timelineCardClassName)}>
        {timelineHeader}
        {timeline ? (
          <div className="flex flex-col gap-3">
            <div className="w-full min-w-0">{timeline}</div>
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="icon-lg"
                className="size-14 shrink-0 rounded-full"
                disabled={!srcReady}
                onClick={onTogglePlay}
              >
                {isPlaying ? <Pause className="size-7" /> : <Play className="size-7" />}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.01}
                value={scrubValue}
                disabled={!srcReady}
                onChange={(e) => onSeek(Number(e.target.value))}
                className={cn("h-1.5 w-full cursor-pointer accent-primary")}
              />
              <div className="mt-1 flex justify-between text-xs tabular-nums text-muted-foreground">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
            <Button
              variant="outline"
              size="icon-lg"
              className="size-14 shrink-0 rounded-full"
              disabled={!srcReady}
              onClick={onTogglePlay}
            >
              {isPlaying ? <Pause className="size-7" /> : <Play className="size-7" />}
            </Button>
          </div>
        )}
        {timelineFooter}
      </div>
    </div>
  );
}
