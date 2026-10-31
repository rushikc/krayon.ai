import { ChevronsDownUp, ChevronsUpDown, Scissors } from "lucide-react";
import { useMemo, useState } from "react";

import { ClipGroups } from "@/components/layout/clip-list";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { StudioClip, StudioGroup } from "@/lib/api/studio-client";
import {
  clipMatchesFilter,
  cycleStatusFilter,
  isAccepted,
  statusDotTone,
  statusWord,
  takeLabelFromId,
  type ClipStatusFilter,
} from "@/lib/studio-clip";
import { studioCopy } from "@/lib/studio-copy";
import { cn } from "@/lib/utils";

function StatusDot({
  status,
  decidedBy,
  statusReason,
}: {
  status: StudioClip["status"];
  decidedBy: StudioClip["decidedBy"];
  statusReason?: string;
}) {
  const accepted = statusDotTone(status) === "accepted";
  const label = accepted ? studioCopy.accepted : studioCopy.notAccepted;
  const tip = [statusWord(status), decidedBy, statusReason].filter(Boolean).join(" · ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn("mt-1 inline-flex size-2 shrink-0 rounded-full", accepted ? "bg-emerald-500" : "bg-red-500")}
            data-testid="status-dot"
            data-tone={accepted ? "accepted" : "not-accepted"}
            aria-label={label}
          />
        }
      />
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

export function StudioClipsPanel({
  clips,
  groups,
  selectedClipId,
  filter,
  onFilterChange,
  onSelect,
  onPlay,
}: {
  clips: StudioClip[];
  groups: StudioGroup[];
  selectedClipId: string | null;
  filter: ClipStatusFilter;
  onFilterChange: (filter: ClipStatusFilter) => void;
  onSelect: (clipId: string) => void;
  onPlay: (clipId: string) => void;
}) {
  const acceptedCount = clips.filter(isAccepted).length;
  const notAcceptedCount = clips.length - acceptedCount;
  const visible = useMemo(
    () => clips.filter((clip) => clipMatchesFilter(clip, filter)),
    [clips, filter],
  );
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const visibleGroups = useMemo(() => {
    const ids = new Set(visible.map((clip) => clip.id));
    return groups
      .map((group) => ({ ...group, clipIds: group.clipIds.filter((id) => ids.has(id)) }))
      .filter((group) => group.clipIds.length > 0);
  }, [groups, visible]);
  const allCollapsed =
    visibleGroups.length > 0 && visibleGroups.every((group) => expandedMap[group.id] === false);

  function toggleAllGroups() {
    setExpandedMap((current) => {
      const next = { ...current };
      for (const group of visibleGroups) next[group.id] = allCollapsed;
      return next;
    });
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-background/60 backdrop-blur-2xl" data-testid="studio-clips">
      <div className="border-b border-border p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Scissors className="size-3.5" />
              {studioCopy.clips}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs" data-testid="clip-summary">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => onFilterChange(cycleStatusFilter(filter))}
              >
                <span className="size-2 rounded-full bg-emerald-500" />
                {acceptedCount} accepted
              </button>
              <span className="text-muted-foreground">·</span>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => onFilterChange(cycleStatusFilter(filter))}
              >
                <span className="size-2 rounded-full bg-red-500" />
                {notAcceptedCount} not accepted
              </button>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="shrink-0"
            data-testid="toggle-all-groups"
            onClick={toggleAllGroups}
          >
            {allCollapsed ? <ChevronsUpDown className="size-3" /> : <ChevronsDownUp className="size-3" />}
            {allCollapsed ? "Expand all" : "Collapse all"}
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          <TooltipProvider>
            <ClipGroups
              groups={visibleGroups}
              clips={visible.map((clip) => ({ ...clip, index: 0 }))}
              selectedClipId={selectedClipId}
              takeLabel={(clip) => takeLabelFromId(clip.id)}
              recommendedId={(group) => group.recommendedClipId}
              expandedMap={expandedMap}
              onExpandedChange={setExpandedMap}
              collapseOnClipDoubleClick
              headerExtra={(_group, groupClips) => {
                const accepted = groupClips.filter((clip) => isAccepted(visible.find((item) => item.id === clip.id) ?? { status: "undecided" })).length;
                return (
                  <span className="text-[10px] text-muted-foreground">
                    {studioCopy.groupAccepted(accepted, groupClips.length)}
                  </span>
                );
              }}
              leading={(clip) => {
                const full = visible.find((item) => item.id === clip.id);
                if (!full) return null;
                return (
                  <StatusDot status={full.status} decidedBy={full.decidedBy} statusReason={full.statusReason} />
                );
              }}
              extraTitle={(clip) => (
                <span
                  className="font-mono text-[10px] text-muted-foreground"
                  title={studioCopy.copyId}
                  onClick={(event) => {
                    event.stopPropagation();
                    void navigator.clipboard.writeText(clip.id);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  {clip.id}
                </span>
              )}
              issueLabel={() => null}
              onPreviewClip={onSelect}
              onPlayClip={onPlay}
            />
          </TooltipProvider>
        </div>
      </ScrollArea>
    </aside>
  );
}
