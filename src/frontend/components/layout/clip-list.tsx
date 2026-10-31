import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/ui/truncated-text";
import { clipIssueLabel } from "@/lib/delivery-issue";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClipGroup, ClipItem } from "@/types/api";

export function ClipListPlayButton({
  onClick,
}: {
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="shrink-0 text-muted-foreground hover:text-primary"
      onClick={onClick}
      aria-label="Play"
    >
      <Play className="size-3.5" />
    </Button>
  );
}

export function SpeechClipRow({
  clip,
  selected,
  isBest,
  takeLabel,
  issueLabel,
  dimmed,
  leading,
  extraTitle,
  trailing,
  onPreview,
  onPlay,
}: {
  clip: Pick<ClipItem, "id" | "index" | "text" | "duration">;
  selected: boolean;
  isBest?: boolean;
  takeLabel?: string;
  issueLabel?: string | null;
  dimmed?: boolean;
  leading?: ReactNode;
  extraTitle?: ReactNode;
  trailing?: ReactNode;
  onPreview: () => void;
  onPlay: () => void;
}) {
  const resolvedIssue = issueLabel === undefined ? clipIssueLabel(clip as ClipItem) : issueLabel;
  const label = takeLabel ?? `Take ${clip.index + 1}`;
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "flex cursor-pointer items-start gap-1 rounded-md border px-2 py-1.5 text-left text-xs",
        resolvedIssue
          ? "border-yellow-500/50 bg-yellow-500/15 text-yellow-100"
          : selected
            ? "border-transparent bg-primary/15 text-primary"
            : "border-transparent hover:bg-muted/60",
      )}
      onClick={onPreview}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPreview();
        }
      }}
    >
      {leading}
      <div className={cn("min-w-0 flex-1 text-left", dimmed && "opacity-60")}>
        <span className="flex items-baseline gap-1.5">
          <span className="whitespace-nowrap font-medium">{label}</span>
          {extraTitle}
          {isBest && !resolvedIssue && (
            <span className="text-[10px] font-medium uppercase tracking-wide text-primary">
              Best
            </span>
          )}
          {resolvedIssue && (
            <span className="text-[10px] font-medium uppercase tracking-wide text-yellow-400">
              {resolvedIssue}
            </span>
          )}
        </span>
        <TruncatedText text={clip.text} className="text-muted-foreground" />
        <span className="text-muted-foreground">{formatDuration(clip.duration)}</span>
      </div>
      {trailing}
      <ClipListPlayButton
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
      />
    </div>
  );
}

export function ClipGroups({
  groups,
  clips,
  selectedClipId,
  onPreviewClip,
  onPlayClip,
  takeLabel,
  leading,
  extraTitle,
  trailing,
  headerExtra,
  dimmed,
  recommendedId,
}: {
  groups: Array<ClipGroup & { recommendedClipId?: string | null }>;
  clips: Array<Pick<ClipItem, "id" | "index" | "text" | "duration">>;
  selectedClipId: string | null;
  onPreviewClip: (clipId: string) => void;
  onPlayClip: (clipId: string) => void;
  takeLabel?: (clip: Pick<ClipItem, "id" | "index" | "text" | "duration">) => string;
  leading?: (clip: Pick<ClipItem, "id" | "index" | "text" | "duration">) => ReactNode;
  extraTitle?: (clip: Pick<ClipItem, "id" | "index" | "text" | "duration">) => ReactNode;
  trailing?: (clip: Pick<ClipItem, "id" | "index" | "text" | "duration">) => ReactNode;
  headerExtra?: (
    group: ClipGroup & { recommendedClipId?: string | null },
    groupClips: Array<Pick<ClipItem, "id" | "index" | "text" | "duration">>,
  ) => ReactNode;
  dimmed?: (clip: Pick<ClipItem, "id" | "index" | "text" | "duration">) => boolean;
  recommendedId?: (group: ClipGroup & { recommendedClipId?: string | null }) => string | null | undefined;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const clipsById = useMemo(() => {
    const map = new Map<string, Pick<ClipItem, "id" | "index" | "text" | "duration">>();
    for (const clip of clips) map.set(clip.id, clip);
    return map;
  }, [clips]);

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const isOpen = expanded[group.id] ?? true;
        const groupClips = group.clipIds
          .map((id) => clipsById.get(id))
          .filter(Boolean) as Array<Pick<ClipItem, "id" | "index" | "text" | "duration">>;
        const bestId = recommendedId?.(group) ?? group.referenceClipId;

        return (
          <div key={group.id} className="rounded-lg border border-border/60 bg-background/40">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
              onClick={() => setExpanded((s) => ({ ...s, [group.id]: !isOpen }))}
            >
              {isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
              <TruncatedText text={group.label} className="min-w-0 flex-1" />
              {headerExtra?.(group, groupClips)}
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{groupClips.length}</span>
            </button>
            {isOpen && (
              <div className="space-y-1 border-t border-border/60 p-2">
                {groupClips.map((clip) => (
                  <SpeechClipRow
                    key={clip.id}
                    clip={clip}
                    selected={selectedClipId === clip.id}
                    isBest={bestId === clip.id}
                    takeLabel={takeLabel?.(clip)}
                    leading={leading?.(clip)}
                    extraTitle={extraTitle?.(clip)}
                    trailing={trailing?.(clip)}
                    dimmed={dimmed?.(clip)}
                    onPreview={() => onPreviewClip(clip.id)}
                    onPlay={() => onPlayClip(clip.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
