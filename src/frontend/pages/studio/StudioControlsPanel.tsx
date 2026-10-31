import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogPopup, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field-label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getToolsStatus } from "@/lib/api/client";
import type { ConfirmationItem, StudioSettings } from "@/lib/api/studio-client";
import { formatDuration, formatSize } from "@/lib/format";
import { studioCopy } from "@/lib/studio-copy";
import { ConfirmationTray } from "@/pages/studio/ConfirmationTray";
import type { RenderManifest } from "@/pages/studio/StudioPreviewPanel";
import type { ToolStatus } from "@/types/api";

export type StudioSegmentRow = {
  kind: "speech" | "silence";
  sourceStart: number;
  sourceEnd: number;
  duration: number;
  text: string;
  clipId: string | null;
  status: string | null;
};

export function StudioControlsPanel({
  asks,
  highlightAsk,
  busyAsk,
  onAnswer,
  onSelectClip,
  onDismissAsk,
  settings,
  onSaveSettings,
  selectedCount,
  selectedClock,
  warnings,
  onSelectWarning,
  renderBusy,
  renderProgress,
  onRender,
  onCancelRender,
  renders,
  onPlayRender,
  onLoadSegments,
  onLoadTranscript,
  clipCount,
  hasTranscript,
  hasSource,
  issueLabel,
  analysisBusy,
  analysisMessage,
  onAnalyze,
  onRebuild,
}: {
  asks: ConfirmationItem[];
  highlightAsk: string | null;
  busyAsk: string | null;
  onAnswer: (item: ConfirmationItem, optionId: string, note: string) => void;
  onSelectClip: (id: string) => void;
  onDismissAsk: () => void;
  settings: StudioSettings;
  onSaveSettings: (next: StudioSettings) => void;
  selectedCount: number;
  selectedClock: string;
  warnings: { code: string; message: string; clipId?: string }[];
  onSelectWarning: (clipId: string) => void;
  renderBusy: boolean;
  renderProgress: { message: string; ratio: number } | null;
  onRender: (quality: "preview" | "final") => void;
  onCancelRender: () => void;
  renders: RenderManifest[];
  onPlayRender: (name: string) => void;
  onLoadSegments: () => Promise<{ segments: StudioSegmentRow[] }>;
  onLoadTranscript: () => Promise<{ words: Array<{ text: string; start: number; end: number; clipId: string | null }> }>;
  clipCount: number;
  hasTranscript: boolean;
  hasSource: boolean;
  issueLabel?: string | null;
  analysisBusy: boolean;
  analysisMessage?: string | null;
  onAnalyze: () => void;
  onRebuild: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(settings);
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [segments, setSegments] = useState<StudioSegmentRow[]>([]);
  const [words, setWords] = useState<Array<{ text: string; start: number; end: number; clipId: string | null }>>([]);
  const [search, setSearch] = useState("");
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const empty = clipCount === 0;

  useEffect(() => setDraft(settings), [settings]);

  const refreshTools = async () => {
    setToolsLoading(true);
    try {
      setTools(await getToolsStatus());
    } catch {
      setTools(null);
    } finally {
      setToolsLoading(false);
    }
  };

  useEffect(() => {
    void refreshTools();
  }, []);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-background/60 backdrop-blur-2xl" data-testid="studio-controls">
      <div className="border-b border-border p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{studioCopy.controls}</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {issueLabel ? (
          <span className="w-fit rounded bg-yellow-500/15 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-yellow-400" data-testid="controls-issue">
            {issueLabel}
          </span>
        ) : null}
        {empty ? null : (
        <ConfirmationTray
          items={asks}
          highlightId={highlightAsk}
          busyId={busyAsk}
          onAnswer={onAnswer}
          onSelectClip={onSelectClip}
          onDismiss={onDismissAsk}
        />
        )}

        <details className="rounded-xl border border-border bg-card/50 p-4" data-testid="settings-box">
          <summary className="cursor-pointer text-sm font-medium">{studioCopy.settings}</summary>
          <div className="mt-3 space-y-3">
            <div className="flex justify-end">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  if (editing) onSaveSettings(draft);
                  setEditing((value) => !value);
                }}
              >
                {editing ? studioCopy.done : studioCopy.edit}
              </Button>
            </div>
            <label className="block space-y-1 text-xs">
              <FieldLabel label={studioCopy.silenceThreshold} />
              <input
                type="number"
                min={0.1}
                max={2}
                step={0.05}
                readOnly={!editing}
                value={draft.silenceThreshold}
                onChange={(event) => setDraft({ ...draft, silenceThreshold: Number(event.target.value) })}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <FieldLabel label={studioCopy.pad} />
              <input
                type="number"
                min={0}
                max={0.5}
                step={0.01}
                readOnly={!editing}
                value={draft.pad}
                onChange={(event) => setDraft({ ...draft, pad: Number(event.target.value) })}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <FieldLabel label={studioCopy.similarity} />
              <input
                type="number"
                min={0.1}
                max={1}
                step={0.05}
                readOnly={!editing}
                value={draft.similarityThreshold}
                onChange={(event) => setDraft({ ...draft, similarityThreshold: Number(event.target.value) })}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <FieldLabel label={studioCopy.analysisRun} />
              <select disabled className="w-full rounded-md border border-input bg-background px-2 py-1.5">
                <option>{studioCopy.currentAnalysis}</option>
              </select>
            </label>
            <div className="space-y-2 text-xs">
              <p className="font-medium">{studioCopy.backendTools}</p>
              <p className="text-muted-foreground">
                {studioCopy.toolsReady(Boolean(tools?.ffmpeg), Boolean(tools?.ffprobe), Boolean(tools?.whisperReady))}
              </p>
              <Button type="button" variant="outline" size="sm" disabled={toolsLoading} onClick={() => void refreshTools()}>
                {toolsLoading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {studioCopy.refresh}
              </Button>
            </div>
          </div>
        </details>

        <section className="space-y-2 rounded-xl border border-border bg-card/50 p-4">
          {analysisMessage ? <p className="text-xs text-muted-foreground">{analysisMessage}</p> : null}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="block w-full">
                    <Button
                      type="button"
                      className="w-full"
                      variant={empty ? "default" : "outline"}
                      disabled={analysisBusy || !hasSource}
                      onClick={onAnalyze}
                    >
                      {studioCopy.analyzeAudio}
                    </Button>
                  </span>
                }
              />
              {!hasSource ? <TooltipContent>{studioCopy.addSourceVideo}</TooltipContent> : null}
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="block w-full">
                    <Button
                      type="button"
                      className="w-full"
                      variant="outline"
                      disabled={analysisBusy || !hasTranscript}
                      onClick={() => setRebuildOpen(true)}
                    >
                      {studioCopy.rebuild}
                    </Button>
                  </span>
                }
              />
              {!hasTranscript ? <TooltipContent>{studioCopy.rebuildFirst}</TooltipContent> : null}
            </Tooltip>
          </TooltipProvider>
        </section>

        {empty ? null : (
        <>
        <section className="space-y-2 rounded-xl border border-border bg-card/50 p-4">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              setSegmentsOpen(true);
              void onLoadSegments().then((result) => setSegments(result.segments));
            }}
          >
            {studioCopy.showAllSegments}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              setTranscriptOpen(true);
              void onLoadTranscript().then((result) => setWords(result.words));
            }}
          >
            {studioCopy.viewTranscript}
          </Button>
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
          <p className="text-xs text-muted-foreground">{studioCopy.selectedSummary(selectedCount, selectedClock)}</p>
          {warnings.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-xs font-medium">{studioCopy.lintWarnings}</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {warnings.map((warning) => (
                  <li key={`${warning.code}-${warning.message}`}>
                    <button
                      type="button"
                      className="text-left underline"
                      onClick={() => warning.clipId && onSelectWarning(warning.clipId)}
                    >
                      {warning.message}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {renderProgress ? (
            <div data-testid="render-progress">
              <p className="text-xs text-muted-foreground">
                {renderProgress.message} {Math.round(renderProgress.ratio * 100)}%
              </p>
              <Progress value={Math.round(renderProgress.ratio * 100)} />
            </div>
          ) : null}
          <Button type="button" className="w-full" disabled={renderBusy} onClick={() => onRender("preview")}>
            {studioCopy.renderPreview}
          </Button>
          <Button type="button" className="w-full" disabled={renderBusy} onClick={() => onRender("final")}>
            {studioCopy.renderFinal}
          </Button>
          {renderBusy ? (
            <Button type="button" variant="destructive" className="w-full" onClick={onCancelRender}>
              {studioCopy.cancelRender}
            </Button>
          ) : null}
          {renders.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium">{studioCopy.recentRenders}</p>
            <ul className="space-y-2 text-xs">
              {renders.map((item) => (
                <li key={item.name} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {item.name} · {item.quality} · {formatDuration(item.duration)} · {item.size ? formatSize(item.size) : ""}
                  </span>
                  <Button type="button" size="xs" variant="outline" onClick={() => onPlayRender(item.name)}>
                    {studioCopy.playRender}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => void navigator.clipboard.writeText(item.outputPath ?? item.name)}
                  >
                    {studioCopy.copyPath}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          ) : null}
        </section>
        </>
        )}
      </div>

      <Dialog open={rebuildOpen} onOpenChange={setRebuildOpen}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup>
            <DialogTitle>{studioCopy.rebuildConfirmTitle}</DialogTitle>
            <p className="mt-2 text-sm text-muted-foreground">{studioCopy.rebuildConfirm}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRebuildOpen(false)}>
                {studioCopy.cancel}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setRebuildOpen(false);
                  onRebuild();
                }}
              >
                {studioCopy.rebuildConfirmAction}
              </Button>
            </div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>

      <Dialog open={segmentsOpen} onOpenChange={setSegmentsOpen}>
        <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="flex max-h-[80vh] max-w-lg flex-col">
          <DialogTitle>{studioCopy.showAllSegments}</DialogTitle>
          <ScrollArea className="mt-3 max-h-[60vh]">
            <ul className="space-y-1 text-xs" data-testid="all-segments">
              {segments.map((segment, index) => (
                <li key={`${segment.sourceStart}-${index}`} className="flex items-start gap-2 rounded-md border border-border px-2 py-1.5">
                  <span
                    className={`mt-1 size-2 shrink-0 rounded-full ${segment.status === "selected" ? "bg-emerald-500" : "bg-red-500"}`}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      if (segment.clipId) {
                        onSelectClip(segment.clipId);
                        setSegmentsOpen(false);
                      }
                    }}
                  >
                    <p>
                      {formatDuration(segment.sourceStart)}–{formatDuration(segment.sourceEnd)} · {formatDuration(segment.duration)}
                      {segment.clipId ? ` · ${segment.clipId}` : ""}
                    </p>
                    <p className="text-muted-foreground">{segment.kind === "silence" ? "Silence" : segment.text}</p>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </DialogPopup>
        </DialogPortal>
      </Dialog>

      <Dialog open={transcriptOpen} onOpenChange={setTranscriptOpen}>
        <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="flex max-h-[80vh] max-w-lg flex-col">
          <DialogTitle>{studioCopy.viewTranscript}</DialogTitle>
          <input
            className="mt-3 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            placeholder={studioCopy.searchTranscript}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <ScrollArea className="mt-3 max-h-[60vh]">
            <div className="flex flex-wrap gap-1 text-xs">
              {(search.trim()
                ? words.filter((word) => word.text.toLowerCase().includes(search.trim().toLowerCase()))
                : words
              ).map((word, index) => (
                <button
                  key={`${word.start}-${index}`}
                  type="button"
                  className="rounded bg-muted px-1 py-0.5"
                  onClick={() => {
                    if (word.clipId) {
                      onSelectClip(word.clipId);
                      setTranscriptOpen(false);
                    }
                  }}
                >
                  {word.text}
                </button>
              ))}
            </div>
          </ScrollArea>
        </DialogPopup>
        </DialogPortal>
      </Dialog>
    </aside>
  );
}
