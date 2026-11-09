import { Check, ChevronsDownUp, ChevronsUpDown, Loader2, Scissors } from "lucide-react";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

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
  scriptedGroupLabel,
  takeLabel,
  type ClipStatusFilter,
} from "@/lib/studio-clip";
import { studioCopy } from "@/lib/studio-copy";
import { cn } from "@/lib/utils";

const CLIPS_WIDTH_KEY = "krayon-studio-clips-width";
const DEFAULT_CLIPS_WIDTH = 576;
const MIN_CLIPS_WIDTH = 240;
const MAX_CLIPS_WIDTH = 800;

function clampClipsWidth(value: number) {
  return Math.min(MAX_CLIPS_WIDTH, Math.max(MIN_CLIPS_WIDTH, value));
}

function readClipsWidth() {
  try {
    const stored = Number(localStorage.getItem(CLIPS_WIDTH_KEY));
    if (!Number.isFinite(stored)) return DEFAULT_CLIPS_WIDTH;
    return clampClipsWidth(stored);
  } catch {
    return DEFAULT_CLIPS_WIDTH;
  }
}

function persistClipsWidth(value: number) {
  try {
    localStorage.setItem(CLIPS_WIDTH_KEY, String(value));
  } catch {
    // localStorage unavailable
  }
}
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
  onDecide,
  projectStatus,
  statusMessage,
}: {
  clips: StudioClip[];
  groups: StudioGroup[];
  selectedClipId: string | null;
  filter: ClipStatusFilter;
  onFilterChange: (filter: ClipStatusFilter) => void;
  onSelect: (clipId: string) => void;
  onPlay: (clipId: string) => void;
  onDecide?: (clipId: string, op: "select" | "reject") => void;
  projectStatus?: string;
  statusMessage?: string;
}) {
  const acceptedCount = clips.filter(isAccepted).length;
  const notAcceptedCount = clips.length - acceptedCount;
  const visible = useMemo(
    () => clips.filter((clip) => clipMatchesFilter(clip, filter)),
    [clips, filter],
  );
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [width, setWidth] = useState(readClipsWidth);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const visibleGroups = useMemo(() => {
    const ids = new Set(visible.map((clip) => clip.id));
    return groups
      .map((group) => {
        const clipIds = group.clipIds.filter((id) => ids.has(id));
        if (group.scriptLine != null) {
          return {
            ...group,
            clipIds,
            label: scriptedGroupLabel(group.scriptLine, group.clipIds.length),
            emptyLabel: studioCopy.lineNotFound(group.scriptLine),
          };
        }
        return { ...group, clipIds };
      })
      .filter((group) => group.clipIds.length > 0 || group.scriptLine != null);
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

  function stopRowClick(event: { stopPropagation: () => void }) {
    event.stopPropagation();
  }

  function onResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onResizePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setWidth(clampClipsWidth(drag.current.startWidth + event.clientX - drag.current.startX));
  }

  function onResizePointerUp() {
    if (!drag.current) return;
    drag.current = null;
    setWidth((current) => {
      persistClipsWidth(current);
      return current;
    });
  }

  function resetClipsWidth() {
    setWidth(DEFAULT_CLIPS_WIDTH);
    persistClipsWidth(DEFAULT_CLIPS_WIDTH);
  }

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-border bg-background/60 backdrop-blur-2xl"
      style={{ width }}
      data-testid="studio-clips"
    >
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
            {projectStatus === "analyzing" ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="clips-analyzing">
                <Loader2 className="size-3 animate-spin" />
                {studioCopy.analyzing}
              </p>
            ) : null}
            {projectStatus === "error" ? (
              <p className="mt-2 text-xs text-destructive" data-testid="clips-error">
                {statusMessage || studioCopy.analyzeFailed}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="size-8 shrink-0"
            data-testid="toggle-all-groups"
            aria-label={allCollapsed ? "Expand all" : "Collapse all"}
            title={allCollapsed ? "Expand all" : "Collapse all"}
            onClick={toggleAllGroups}
          >
            {allCollapsed ? <ChevronsUpDown className="size-4" /> : <ChevronsDownUp className="size-4" />}
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
              takeLabel={(clip) => {
                const full = visible.find((item) => item.id === clip.id);
                return takeLabel(full ?? { id: clip.id, sourceStart: 0 }, clips);
              }}
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
              trailing={(clip) => {
                const full = visible.find((item) => item.id === clip.id);
                if (!full || !onDecide) return null;
                const accepted = full.status === "selected";
                return (
                  <span className="flex shrink-0 items-center gap-1" onClick={stopRowClick} onDoubleClick={stopRowClick}>
                    <button
                      type="button"
                      aria-label={`Accept ${full.id}`}
                      aria-pressed={accepted}
                      className={cn(
                        "inline-flex size-7 items-center justify-center rounded-md border",
                        accepted
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/15",
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDecide(full.id, accepted ? "reject" : "select");
                      }}
                    >
                      <Check className="size-4" strokeWidth={2.75} />
                    </button>
                  </span>
                );
              }}
              issueLabel={() => null}
              onPreviewClip={onSelect}
              onPlayClip={onPlay}
            />
          </TooltipProvider>
        </div>
      </ScrollArea>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize clip list"
        className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onDoubleClick={resetClipsWidth}
      />
    </aside>
  );
}
