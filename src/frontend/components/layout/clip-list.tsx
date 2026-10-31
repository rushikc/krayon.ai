import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useMemo, useState } from "react";

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

function activateOnEnterOrSpace(event: KeyboardEvent, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
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
  onDoubleClick,
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
  onDoubleClick?: () => void;
}) {
  const resolvedIssue = issueLabel === undefined ? clipIssueLabel(clip as ClipItem) : issueLabel;
  const label = takeLabel ?? `Take ${clip.index + 1}`;
  return (
    <div
      className="group relative -my-0.5 py-2"
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onPreview}
      onDoubleClick={onDoubleClick}
      onKeyDown={(event) => activateOnEnterOrSpace(event, onPreview)}
    >
      <div
        className={cn(
          "relative z-10 flex items-start gap-1 rounded-md border px-2 py-1.5 text-left text-xs",
          resolvedIssue
            ? "border-yellow-500/50 bg-yellow-500/15 text-yellow-100"
            : selected
              ? "border-transparent bg-primary/15 text-primary"
              : "border-transparent group-hover:bg-muted/60",
        )}
      >
        {leading}
        <div className={cn("min-w-0 flex-1 text-left", dimmed && "opacity-60")}>
          <span className="flex items-baseline gap-1.5">
            <span className="whitespace-nowrap font-medium text-foreground">{label}</span>
            {extraTitle ? <span className="pointer-events-auto">{extraTitle}</span> : null}
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
          <TruncatedText text={clip.text} className="pointer-events-none text-foreground/80" />
          <span className="text-foreground/80">{formatDuration(clip.duration)}</span>
        </div>
        {trailing}
        <span
          className="pointer-events-auto"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <ClipListPlayButton
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
          />
        </span>
      </div>
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
  issueLabel,
  headerExtra,
  dimmed,
  recommendedId,
  expandedMap,
  onExpandedChange,
  collapseOnClipDoubleClick,
}: {
  groups: Array<ClipGroup & { recommendedClipId?: string | null; emptyLabel?: string }>;
  clips: Array<Pick<ClipItem, "id" | "index" | "text" | "duration">>;
  selectedClipId: string | null;
  onPreviewClip: (clipId: string) => void;
  onPlayClip: (clipId: string) => void;
  takeLabel?: (clip: Pick<ClipItem, "id" | "index" | "text" | "duration">) => string;
  leading?: (clip: Pick<ClipItem, "id" | "index" | "text" | "duration">) => ReactNode;
  extraTitle?: (clip: Pick<ClipItem, "id" | "index" | "text" | "duration">) => ReactNode;
  trailing?: (clip: Pick<ClipItem, "id" | "index" | "text" | "duration">) => ReactNode;
  issueLabel?: (clip: Pick<ClipItem, "id" | "index" | "text" | "duration">) => string | null;
  headerExtra?: (
    group: ClipGroup & { recommendedClipId?: string | null; emptyLabel?: string },
    groupClips: Array<Pick<ClipItem, "id" | "index" | "text" | "duration">>,
  ) => ReactNode;
  dimmed?: (clip: Pick<ClipItem, "id" | "index" | "text" | "duration">) => boolean;
  recommendedId?: (group: ClipGroup & { recommendedClipId?: string | null }) => string | null | undefined;
  expandedMap?: Record<string, boolean>;
  onExpandedChange?: (next: Record<string, boolean>) => void;
  collapseOnClipDoubleClick?: boolean;
}) {
  const [uncontrolled, setUncontrolled] = useState<Record<string, boolean>>({});
  const expanded = expandedMap ?? uncontrolled;

  function setExpanded(updater: (current: Record<string, boolean>) => Record<string, boolean>) {
    const next = updater(expanded);
    onExpandedChange?.(next);
    if (expandedMap === undefined) setUncontrolled(next);
  }

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
        const toggle = () => setExpanded((s) => ({ ...s, [group.id]: !isOpen }));

        return (
          <div key={group.id} className="rounded-lg border border-border/60 bg-background/40">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-medium"
              onClick={toggle}
              onKeyDown={(event) => activateOnEnterOrSpace(event, toggle)}
            >
              {isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
              <TruncatedText text={group.label} className="min-w-0 flex-1" />
              {headerExtra?.(group, groupClips)}
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{groupClips.length}</span>
            </div>
            {isOpen && (
              <div className="space-y-1 border-t border-border/60 p-2">
                {groupClips.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-amber-600" data-testid="missing-script-line">
                    {group.emptyLabel ?? "Line not found"}
                  </p>
                ) : null}
                {groupClips.map((clip) => (
                  <SpeechClipRow
                    key={clip.id}
                    clip={clip}
                    selected={selectedClipId === clip.id}
                    isBest={bestId === clip.id}
                    takeLabel={takeLabel?.(clip)}
                    issueLabel={issueLabel ? issueLabel(clip) : undefined}
                    leading={leading?.(clip)}
                    extraTitle={extraTitle?.(clip)}
                    trailing={trailing?.(clip)}
                    dimmed={dimmed?.(clip)}
                    onPreview={() => onPreviewClip(clip.id)}
                    onPlay={() => onPlayClip(clip.id)}
                    onDoubleClick={
                      collapseOnClipDoubleClick
                        ? () => setExpanded((s) => ({ ...s, [group.id]: false }))
                        : undefined
                    }
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
