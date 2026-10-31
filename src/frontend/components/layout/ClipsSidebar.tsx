import { Scissors } from "lucide-react";
import { useMemo } from "react";

import { ClipGroups, ClipListPlayButton } from "@/components/layout/clip-list";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TruncatedText } from "@/components/ui/truncated-text";
import { clipIssueLabel } from "@/lib/delivery-issue";
import { formatDuration } from "@/lib/format";
import { buildTimeline, isTimelineEntrySelected } from "@/lib/timeline";
import { cn } from "@/lib/utils";
import { useMediaStore } from "@/stores/media-store";
import { useSilenceStore } from "@/stores/silence-store";

function TimelineList({
  entries,
  selectedEntry,
  onPreviewSpeech,
  onPlaySpeech,
  onPreviewSilence,
  onPlaySilence,
}: {
  entries: ReturnType<typeof buildTimeline>;
  selectedEntry: ReturnType<typeof useMediaStore.getState>["selectedEntry"];
  onPreviewSpeech: (clipId: string) => void;
  onPlaySpeech: (clipId: string) => void;
  onPreviewSilence: (start: number, end: number) => void;
  onPlaySilence: (start: number, end: number) => void;
}) {
  return (
    <div className="space-y-1">
      {entries.map((entry, i) => {
        const selected = isTimelineEntrySelected(entry, selectedEntry);
        const isSilence = entry.kind === "silence";

        const speechIssue = entry.kind === "speech" ? clipIssueLabel(entry.clip) : null;

        return (
          <div
            key={`${entry.kind}-${entry.start}-${i}`}
            className={cn(
              "flex items-start gap-1 rounded-md border px-2 py-1.5 text-xs",
              isSilence
                ? selected
                  ? "border-red-500/30 bg-red-500/15 text-red-100"
                  : "border-red-500/15 bg-red-500/10 text-red-200/80 hover:bg-red-500/15"
                : speechIssue
                  ? "border-yellow-500/50 bg-yellow-500/15 text-yellow-100"
                  : selected
                    ? "border-primary/20 bg-primary/15 text-primary"
                    : "border-transparent hover:bg-muted/60",
            )}
          >
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                if (entry.kind === "speech") {
                  onPreviewSpeech(entry.clip.id);
                } else {
                  onPreviewSilence(entry.start, entry.end);
                }
              }}
            >
              {entry.kind === "speech" ? (
                <>
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-medium">Take {entry.clip.index + 1}</span>
                    {speechIssue && (
                      <span className="text-[10px] font-medium uppercase tracking-wide text-yellow-400">
                        {speechIssue}
                      </span>
                    )}
                  </span>
                  <TruncatedText text={entry.clip.text} className="text-muted-foreground" />
                  <span className="text-muted-foreground">
                    {formatDuration(entry.start)} · {formatDuration(entry.end - entry.start)}
                  </span>
                </>
              ) : (
                <>
                  <TruncatedText text={entry.label} />
                  <span className="opacity-80">{formatDuration(entry.end - entry.start)}</span>
                </>
              )}
            </button>
            <ClipListPlayButton
              onClick={(e) => {
                e.stopPropagation();
                if (entry.kind === "speech") {
                  onPlaySpeech(entry.clip.id);
                } else {
                  onPlaySilence(entry.start, entry.end);
                }
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

export function ClipsSidebar() {
  const {
    files,
    selectedId,
    clips,
    clipGroups,
    selectedClipId,
    selectedEntry,
    selectSpeechClip,
    selectSilenceRange,
  } = useMediaStore();
  const { listMode } = useSilenceStore();

  const selectedFile = files.find((f) => f.id === selectedId) ?? null;

  const timeline = useMemo(
    () => buildTimeline(selectedFile?.duration, clips),
    [selectedFile?.duration, clips],
  );

  if (clips.length === 0) return null;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-background/60 backdrop-blur-2xl">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Scissors className="size-3.5" />
          {listMode === "all" ? "All segments" : "Clips"}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          {listMode === "speech" ? (
            <ClipGroups
              groups={clipGroups}
              clips={clips}
              selectedClipId={selectedClipId}
              onPreviewClip={(id) => selectSpeechClip(id, false)}
              onPlayClip={(id) => selectSpeechClip(id, true)}
            />
          ) : (
            <TimelineList
              entries={timeline}
              selectedEntry={selectedEntry}
              onPreviewSpeech={(id) => selectSpeechClip(id, false)}
              onPlaySpeech={(id) => selectSpeechClip(id, true)}
              onPreviewSilence={(start, end) => selectSilenceRange(start, end, false)}
              onPlaySilence={(start, end) => selectSilenceRange(start, end, true)}
            />
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
