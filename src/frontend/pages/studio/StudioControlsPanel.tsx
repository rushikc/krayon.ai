import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogPopup, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field-label";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getToolsStatus } from "@/lib/api/client";
import type { AnalysisTimings, ConfirmationItem, StudioSettings } from "@/lib/api/studio-client";
import { countScriptLines } from "@/lib/studio-clip";
import { formatDuration, formatProgressLabel, formatSize, formatElapsedHuman } from "@/lib/format";
import { STUDIO_LANGUAGES } from "@/lib/studio-analysis-steps";
import { studioCopy } from "@/lib/studio-copy";
import { ConfirmationTray } from "@/pages/studio/ConfirmationTray";
import type { RenderManifest } from "@/pages/studio/StudioPreviewPanel";
import type { ToolStatus } from "@/types/api";

function highlightWord(text: string, query: string, key: string): { nodes: ReactNode; matches: number } {
  if (!query) return { nodes: text, matches: 0 };
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let matches = 0;
  let from = lower.indexOf(needle, cursor);
  while (from >= 0) {
    if (from > cursor) nodes.push(text.slice(cursor, from));
    nodes.push(
      <mark key={`${key}-${matches}`} className="rounded bg-primary/20 text-foreground">
        {text.slice(from, from + needle.length)}
      </mark>,
    );
    matches += 1;
    cursor = from + needle.length;
    from = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return { nodes: nodes.length ? nodes : text, matches };
}

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
  onLoadTranscript,
  clipCount,
  hasTranscript,
  hasSource,
  issueLabel,
  analysisBusy,
  analysisMessage,
  analysisDurationSeconds,
  analysisTimings,
  onAnalyze,
  onRebuild,
  script,
  onSaveScript,
  lastPipeline,
  scriptLineCount,
  needsRebuild,
  rebuildReason,
  detectedLanguage,
  matchedLines,
  missingLines,
  onContinueToVisuals,
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
  onLoadTranscript: () => Promise<{ words: Array<{ text: string; start: number; end: number; clipId: string | null }> }>;
  clipCount: number;
  hasTranscript: boolean;
  hasSource: boolean;
  issueLabel?: string | null;
  analysisBusy: boolean;
  analysisMessage?: string | null;
  analysisDurationSeconds?: number | null;
  analysisTimings?: AnalysisTimings | null;
  onAnalyze: () => void;
  onRebuild: (pipeline?: "scripted" | "transcript") => void;
  script: string;
  onSaveScript: (script: string) => void;
  lastPipeline?: "transcript" | "scripted" | null;
  scriptLineCount: number;
  needsRebuild?: boolean;
  rebuildReason?: "script" | "language" | null;
  detectedLanguage?: string | null;
  matchedLines: number;
  missingLines: number;
  onContinueToVisuals?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(settings);
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [words, setWords] = useState<Array<{ text: string; start: number; end: number; clipId: string | null }>>([]);
  const [search, setSearch] = useState("");
  const transcriptBodyRef = useRef<HTMLDivElement>(null);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [scriptDraft, setScriptDraft] = useState(script);
  const empty = clipCount === 0;
  const hasScript = countScriptLines(script) > 0;
  const analysisDurationLabel = formatElapsedHuman(analysisDurationSeconds);

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => setScriptDraft(script), [script]);

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

  const query = search.trim();
  const highlighted = useMemo(() => {
    return words.map((word, index) => {
      const key = `${word.start}-${index}`;
      const { nodes, matches } = highlightWord(word.text, query, key);
      return { word, index, key, nodes, matches };
    });
  }, [words, query]);
  const matchCount = highlighted.reduce((sum, item) => sum + item.matches, 0);

  useEffect(() => {
    if (!transcriptOpen || !query) return;
    transcriptBodyRef.current?.querySelector("mark")?.scrollIntoView?.({ block: "nearest" });
  }, [query, highlighted, transcriptOpen]);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-background/60 backdrop-blur-2xl" data-testid="studio-controls">
      <div className="border-b border-border p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{studioCopy.controls}</h2>
        <p className="mt-2 text-[11px] text-muted-foreground" data-testid="pipeline-badge">
          {lastPipeline === "scripted"
            ? studioCopy.pipelineScripted(scriptLineCount)
            : studioCopy.pipelineTranscript}
        </p>
        {lastPipeline === "scripted" ? (
          <p className="text-[11px] text-muted-foreground" data-testid="pipeline-stats">
            {studioCopy.pipelineStats(scriptLineCount, matchedLines, missingLines)}
          </p>
        ) : null}
        {needsRebuild ? (
          <p className="mt-1 text-[11px] text-amber-600" data-testid="needs-rebuild">
            {rebuildReason === "language" ? studioCopy.languageChanged : studioCopy.needsRebuild}
          </p>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scroll-thin p-4">
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
            <fieldset className="space-y-2 text-xs" data-testid="settings-grouping-mode">
              <FieldLabel label={studioCopy.grouping} />
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="settingsGroupingMode"
                  checked={(draft.groupingMode ?? "timeline") === "timeline"}
                  onChange={() => {
                    const next = { ...draft, groupingMode: "timeline" as const };
                    setDraft(next);
                    onSaveSettings(next);
                  }}
                />
                <span>{studioCopy.groupingTimeline}</span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="settingsGroupingMode"
                  checked={draft.groupingMode === "global"}
                  onChange={() => {
                    const next = { ...draft, groupingMode: "global" as const };
                    setDraft(next);
                    onSaveSettings(next);
                  }}
                />
                <span>{studioCopy.groupingGlobal}</span>
              </label>
              <p className="text-muted-foreground">{studioCopy.groupingHint}</p>
            </fieldset>
            <label className="block space-y-1 text-xs">
              <FieldLabel label={studioCopy.scriptOptional} />
              <textarea
                data-testid="settings-script"
                className="min-h-24 w-full rounded-md border border-input bg-background px-2 py-1.5"
                value={scriptDraft}
                onChange={(event) => setScriptDraft(event.target.value)}
              />
              <p className="text-muted-foreground">{studioCopy.scriptLines(countScriptLines(scriptDraft))}</p>
              <Button type="button" size="xs" variant="outline" onClick={() => onSaveScript(scriptDraft)}>
                {studioCopy.saveScript}
              </Button>
            </label>
            <label className="block space-y-1 text-xs">
              <FieldLabel label={studioCopy.language} />
              <select
                data-testid="settings-language"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5"
                value={draft.language ?? "auto"}
                onChange={(event) => {
                  const next = { ...draft, language: event.target.value };
                  setDraft(next);
                  onSaveSettings(next);
                }}
              >
                {STUDIO_LANGUAGES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.value === "auto" ? studioCopy.languageAuto : item.label}
                  </option>
                ))}
              </select>
            </label>
            {(draft.language ?? "auto") === "en" && detectedLanguage && !detectedLanguage.toLowerCase().startsWith("en") ? (
              <p
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300"
                data-testid="language-warning"
              >
                {studioCopy.languageForcedWarning}
              </p>
            ) : null}
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
          {analysisDurationLabel && !analysisBusy ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground" data-testid="analysis-duration">
                {studioCopy.analysisTook(analysisDurationLabel)}
              </p>
              {analysisTimings?.stages?.length ? (
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-xs text-muted-foreground" data-testid="analysis-timings">
                  {analysisTimings.stages.map((stage) => {
                    const duration = formatElapsedHuman(stage.seconds) ?? "0 s";
                    const value =
                      stage.status === "skipped"
                        ? `skipped ${duration}`
                        : stage.status === "pending"
                          ? "—"
                          : duration;
                    return (
                      <div key={stage.id} className="contents">
                        <dt className={stage.status === "error" ? "truncate text-destructive" : "truncate"}>{stage.label}</dt>
                        <dd
                          className={
                            stage.status === "error"
                              ? "shrink-0 text-right tabular-nums text-destructive"
                              : "shrink-0 text-right tabular-nums"
                          }
                        >
                          {value}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              ) : null}
            </div>
          ) : null}
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
              {analysisBusy ? (
                <TooltipContent>{studioCopy.analysisRunning}</TooltipContent>
              ) : !hasSource ? (
                <TooltipContent>{studioCopy.addSourceVideo}</TooltipContent>
              ) : null}
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
              {analysisBusy ? (
                <TooltipContent>{studioCopy.analysisRunning}</TooltipContent>
              ) : !hasTranscript ? (
                <TooltipContent>{studioCopy.rebuildFirst}</TooltipContent>
              ) : null}
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
              setTranscriptOpen(true);
              setSearch("");
              void onLoadTranscript().then((result) => setWords(result.words));
            }}
          >
            {studioCopy.viewTranscript}
          </Button>
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
          <p className="text-xs text-muted-foreground">{studioCopy.selectedSummary(selectedCount, selectedClock)}</p>
          {onContinueToVisuals && selectedCount > 0 && !analysisBusy ? (
            <Button type="button" className="w-full" onClick={onContinueToVisuals}>
              {studioCopy.continueToVisuals}
            </Button>
          ) : null}
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
                {formatProgressLabel(renderProgress.message, renderProgress.ratio)}
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
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRebuildOpen(false)}>
                {studioCopy.cancel}
              </Button>
              {hasScript ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="rebuild-without-script"
                    disabled={analysisBusy}
                    title={analysisBusy ? studioCopy.analysisRunning : undefined}
                    onClick={() => {
                      setRebuildOpen(false);
                      onRebuild("transcript");
                    }}
                  >
                    {studioCopy.rebuildWithoutScript}
                  </Button>
                  <Button
                    type="button"
                    data-testid="rebuild-with-script"
                    disabled={analysisBusy}
                    title={analysisBusy ? studioCopy.analysisRunning : undefined}
                    onClick={() => {
                      setRebuildOpen(false);
                      onRebuild("scripted");
                    }}
                  >
                    {studioCopy.rebuildWithScript}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  disabled={analysisBusy}
                  title={analysisBusy ? studioCopy.analysisRunning : undefined}
                  onClick={() => {
                    setRebuildOpen(false);
                    onRebuild();
                  }}
                >
                  {studioCopy.rebuildConfirmAction}
                </Button>
              )}
            </div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>

      <Dialog open={transcriptOpen} onOpenChange={setTranscriptOpen}>
        <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="flex max-h-[80vh] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden">
          <DialogTitle className="shrink-0">{studioCopy.viewTranscript}</DialogTitle>
          <input
            className="mt-3 shrink-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            placeholder={studioCopy.searchTranscript}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {query ? <p className="mt-2 shrink-0 text-xs text-muted-foreground">{matchCount} matches</p> : null}
          <div
            ref={transcriptBodyRef}
            data-testid="transcript-body"
            className="mt-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto scroll-thin text-sm leading-relaxed break-words"
          >
            {highlighted.map((item, index) => (
              <span key={item.key}>
                {index > 0 ? " " : null}
                {item.word.clipId ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer hover:underline"
                    onClick={() => {
                      onSelectClip(item.word.clipId!);
                      setTranscriptOpen(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectClip(item.word.clipId!);
                        setTranscriptOpen(false);
                      }
                    }}
                  >
                    {item.nodes}
                  </span>
                ) : (
                  <span>{item.nodes}</span>
                )}
              </span>
            ))}
          </div>
        </DialogPopup>
        </DialogPortal>
      </Dialog>
    </aside>
  );
}
