import { Copy, Loader2, Redo2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ClipPlayerCard } from "@/components/player/ClipPlayerCard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogPopup, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import type { StudioClip, StudioGroup } from "@/lib/api/studio-client";
import { audioUrl, getClipPeaks, outputUrl, sourceUrl } from "@/lib/api/studio-client";
import { formatDuration, formatSize, formatTimestamp } from "@/lib/format";
import { studioClipIssueLabel } from "@/lib/delivery-issue";
import { playheadToSource, sourceToPlayhead, takeLabelFromId, validateCut } from "@/lib/studio-clip";
import { studioCopy } from "@/lib/studio-copy";
import { StudioWaveform, type StudioWaveformHandle } from "@/pages/studio/StudioWaveform";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";

export type PreviewTab = "clip" | "render" | "source";

export type RenderManifest = {
  name: string;
  quality?: string;
  duration?: number;
  size?: number;
  createdAt?: string | null;
  outputPath?: string;
};

export function StudioPreviewPanel({
  slug,
  clip,
  groups,
  pad,
  tab,
  onTabChange,
  conflictError,
  renders,
  activeRenderName,
  onSelectRender,
  onAccept,
  onReject,
  onPrev,
  onNext,
  autoPlayToken,
  playingRef,
  projectStatus,
  statusMessage,
  onRetryAnalyze,
  onEditingChange,
  onSaveCuts,
  onUndo,
  onRedo,
}: {
  slug: string;
  clip: StudioClip | null;
  groups: StudioGroup[];
  pad: number;
  tab: PreviewTab;
  onTabChange: (tab: PreviewTab) => void;
  conflictError: string | null;
  renders: RenderManifest[];
  activeRenderName: string | null;
  onSelectRender: (name: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onPrev: () => void;
  onNext: () => void;
  autoPlayToken: number;
  playingRef: React.MutableRefObject<boolean>;
  projectStatus?: string;
  statusMessage?: string;
  onRetryAnalyze?: () => void;
  onEditingChange?: (editing: boolean) => void;
  onStayOnClip?: (id: string) => void;
  onSaveCuts?: (clipId: string, at: number[]) => Promise<boolean>;
  onUndo?: () => void;
  onRedo?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playheadRef = useRef(0);
  const ignorePausedZeroRef = useRef(false);
  const waveformRef = useRef<StudioWaveformHandle>(null);
  const rafRef = useRef(0);
  const lastStateMsRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const handledAutoPlay = useRef(0);
  const [rawOpen, setRawOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cuts, setCuts] = useState<number[]>([]);
  const [cutError, setCutError] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [peakDuration, setPeakDuration] = useState(0);
  const [discardOpen, setDiscardOpen] = useState(false);
  const src = clip ? audioUrl(slug, clip.id, pad) : "";
  const selectedRender = renders.find((item) => item.name === activeRenderName) ?? renders[0] ?? null;

  function stopPlayheadLoop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }

  function startPlayheadLoop() {
    stopPlayheadLoop();
    const tick = (now: number) => {
      const audio = audioRef.current;
      if (!audio || audio.paused) {
        rafRef.current = 0;
        return;
      }
      const time = audio.currentTime;
      playheadRef.current = time;
      waveformRef.current?.setPlayheadTime(time);
      if (now - lastStateMsRef.current >= 100) {
        lastStateMsRef.current = now;
        setCurrentTime(time);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    return () => stopPlayheadLoop();
  }, []);

  useEffect(() => {
    playingRef.current = isPlaying && tab === "clip";
  }, [isPlaying, playingRef, tab]);

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  useEffect(() => {
    if (!clip) {
      setPeaks([]);
      return;
    }
    void getClipPeaks(slug, clip.id, 800, pad)
      .then((result) => {
        setPeaks(result.peaks);
        setPeakDuration(result.duration);
      })
      .catch(() => {
        setPeaks([]);
        setPeakDuration(0);
      });
  }, [clip?.id, pad, slug]);

  const cutsRef = useRef(cuts);
  cutsRef.current = cuts;
  const activeClipId = useRef(clip?.id ?? null);

  useEffect(() => {
    stopPlayheadLoop();
    setIsPlaying(false);
    playheadRef.current = 0;
    setCurrentTime(0);
    waveformRef.current?.setPlayheadTime(0);
    handledAutoPlay.current = 0;
    if (clip?.id === activeClipId.current) return;
    activeClipId.current = clip?.id ?? null;
    setEditing(false);
    setCuts([]);
    setCutError(null);
  }, [clip?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || autoPlayToken <= handledAutoPlay.current) return;
    handledAutoPlay.current = autoPlayToken;
    if (audio.paused) {
      void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [autoPlayToken, src]);

  const mates = useMemo(() => {
    if (!clip) return [];
    const group = groups.find((item) => item.id === clip.groupId);
    return (group?.clipIds ?? []).filter((id) => id !== clip.id);
  }, [clip, groups]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  function setPlayhead(value: number) {
    const next = Number.isFinite(value) ? Math.max(0, value) : 0;
    playheadRef.current = next;
    setCurrentTime(next);
    waveformRef.current?.setPlayheadTime(next);
  }

  const seek = (value: number) => {
    const audio = audioRef.current;
    const wasPlaying = audio ? !audio.paused : false;
    stopPlayheadLoop();
    ignorePausedZeroRef.current = audio?.paused !== false;
    setPlayhead(value);
    if (audio && Number.isFinite(value)) {
      try {
        audio.currentTime = value;
      } catch {
        /* jsdom / some webviews ignore currentTime writes */
      }
    }
    if (wasPlaying) startPlayheadLoop();
  };

  function addCutAtPlayhead() {
    if (!clip || !editing) return;
    const at = playheadToSource(playheadRef.current, clip.sourceStart, pad);
    const error = validateCut(at, clip.sourceStart, clip.sourceEnd, cuts);
    if (error) {
      setCutError(studioCopy.cutTooClose);
      return;
    }
    setCuts((current) => [...current, at].sort((left, right) => left - right));
    setCutError(null);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!editing) return;
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        addCutAtPlayhead();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const copyClip = async () => {
    if (!clip) return;
    try {
      await navigator.clipboard.writeText(`${clip.id}\n${clip.text}`);
      toast(studioCopy.copySentence);
    } catch {
      toast("Could not copy");
    }
  };

  const copyJson = async () => {
    if (!clip) return;
    await navigator.clipboard.writeText(JSON.stringify(clip, null, 2));
    toast(studioCopy.copyJson);
  };

  const tabs: Array<{ id: PreviewTab; label: string }> = [
    { id: "clip", label: studioCopy.clipAudio },
    { id: "render", label: studioCopy.renderedVideo },
    { id: "source", label: studioCopy.fullVideo },
  ];

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2" data-testid="preview-tabs">
        {tabs.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="xs"
            variant={tab === item.id ? "default" : "outline"}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" aria-label="Undo" onClick={onUndo}>
            <Undo2 className="size-3.5" />
            Undo
          </Button>
          <Button type="button" variant="outline" size="sm" aria-label="Redo" onClick={onRedo}>
            <Redo2 className="size-3.5" />
            Redo
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {tab === "clip" ? (
          <div className="flex w-full min-w-0 flex-1 flex-col items-center gap-4 p-6">
            {clip ? (
              <div className="flex w-full max-w-3xl min-w-0 flex-col gap-4">
                <ClipPlayerCard
                  takeLabel={takeLabelFromId(clip.id)}
                  issueLabel={studioClipIssueLabel(clip.label)}
                  text={clip.text}
                  copyDisabled={!clip.text.trim()}
                  onCopy={() => void copyClip()}
                  copyTooltip={studioCopy.copySentence}
                  copyAriaLabel={studioCopy.copySentence}
                  srcReady={Boolean(src)}
                  currentTime={currentTime}
                  duration={peakDuration || duration || clip.duration + pad * 2}
                  isPlaying={isPlaying}
                  onSeek={seek}
                  onTogglePlay={() => void togglePlay()}
                  timelineCardClassName={editing ? "border-blue-500" : undefined}
                  timelineHeader={
                    <div className="mb-3 flex items-center justify-end gap-2">
                      {editing ? (
                        <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[11px] font-medium text-blue-300" data-testid="editing-badge">
                          {studioCopy.editing}
                        </span>
                      ) : null}
                      <Button
                        type="button"
                        size="xs"
                        variant={editing ? "outline" : "default"}
                        data-testid="waveform-edit"
                        onClick={() => {
                          if (editing && cuts.length > 0) {
                            setDiscardOpen(true);
                            return;
                          }
                          setEditing((value) => !value);
                          setCutError(null);
                        }}
                      >
                        {editing ? studioCopy.cancel : studioCopy.edit}
                      </Button>
                    </div>
                  }
                  timeline={
                    <StudioWaveform
                      ref={waveformRef}
                      peaks={peaks}
                      duration={peakDuration || duration}
                      currentTime={currentTime}
                      editing={editing}
                      cuts={cuts}
                      sourceStart={clip.sourceStart}
                      sourceEnd={clip.sourceEnd}
                      pad={pad}
                      onSeek={seek}
                      onRemoveCut={(at) => setCuts((current) => current.filter((cut) => cut !== at))}
                    />
                  }
                  timelineFooter={
                    editing ? (
                      <div className="mt-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={addCutAtPlayhead}>
                            {studioCopy.addCut}
                          </Button>
                          <span className="text-xs text-muted-foreground">{studioCopy.pressS}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={cuts.length === 0}
                            onClick={() => setCuts((current) => current.slice(0, -1))}
                          >
                            {studioCopy.undoLastCut}
                          </Button>
                        </div>
                        {cutError ? <p className="text-xs text-destructive">{cutError}</p> : null}
                        <Button
                          type="button"
                          className="w-full"
                          disabled={cuts.length === 0}
                          onClick={() => {
                            const at = cuts;
                            cutsRef.current = [];
                            setCuts([]);
                            void onSaveCuts?.(clip.id, at).then((ok) => {
                              if (ok) {
                                setEditing(false);
                                setCutError(null);
                              } else {
                                cutsRef.current = at;
                                setCuts(at);
                              }
                            });
                          }}
                        >
                          {studioCopy.saveCuts(cuts.length)}
                        </Button>
                      </div>
                    ) : null
                  }
                  audio={
                    <audio
                      ref={audioRef}
                      key={src}
                      src={src}
                      className="hidden"
                      onLoadedMetadata={(event) => {
                        setDuration(event.currentTarget.duration);
                        setPlayhead(0);
                      }}
                      onTimeUpdate={(event) => {
                        const audio = event.currentTarget;
                        if (!audio.paused) return;
                        if (ignorePausedZeroRef.current && audio.currentTime === 0) return;
                        setPlayhead(audio.currentTime);
                      }}
                      onPlay={() => {
                        ignorePausedZeroRef.current = false;
                        setIsPlaying(true);
                        startPlayheadLoop();
                      }}
                      onPause={() => {
                        stopPlayheadLoop();
                        setIsPlaying(false);
                        const audio = audioRef.current;
                        if (audio) setPlayhead(audio.currentTime);
                      }}
                      onEnded={() => {
                        stopPlayheadLoop();
                        setIsPlaying(false);
                      }}
                    />
                  }
                />
                <div className="flex w-full flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant={clip.status === "selected" ? "default" : "outline"}
                      aria-pressed={clip.status === "selected"}
                      onClick={onAccept}
                    >
                      {studioCopy.accept}
                    </Button>
                    <Button
                      type="button"
                      variant={clip.status === "rejected" ? "destructive" : "outline"}
                      aria-pressed={clip.status === "rejected"}
                      onClick={onReject}
                    >
                      {studioCopy.reject}
                    </Button>
                    <span className="text-xs text-muted-foreground" data-testid="status-badge">
                      {clip.status === "selected"
                        ? studioCopy.accepted
                        : clip.status === "rejected"
                          ? studioCopy.rejected
                          : studioCopy.undecided}
                      {" · "}
                      {clip.decidedBy}
                      {clip.statusAt ? ` · ${new Date(clip.statusAt).toLocaleString()}` : ""}
                    </span>
                  </div>
                  {conflictError ? <p className="text-xs text-destructive">{conflictError}</p> : null}
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={onPrev}>
                      {studioCopy.previousClip}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={onNext}>
                      {studioCopy.nextClip}
                    </Button>
                  </div>
                  {clip.words.length > 0 ? (
                    <div className="flex flex-wrap gap-1 text-xs">
                      {clip.words.map((word, index) => (
                        <button
                          key={`${word.start}-${index}`}
                          type="button"
                          className="rounded bg-muted px-1 py-0.5 hover:bg-primary/15"
                          onClick={() => seek(Math.max(0, sourceToPlayhead(word.start, clip.sourceStart, pad)))}
                        >
                          {word.text}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <section className="rounded-xl border border-border bg-card/50 p-4 text-xs" data-testid="clip-data">
                    <p className="mb-2 text-sm font-medium">{studioCopy.clipData}</p>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                      <dt className="text-muted-foreground">label</dt>
                      <dd>{clip.label}</dd>
                      <dt className="text-muted-foreground">score</dt>
                      <dd>{clip.score}</dd>
                      <dt className="text-muted-foreground">reasons</dt>
                      <dd>{clip.reasons.join(", ") || "—"}</dd>
                      <dt className="text-muted-foreground">groupId</dt>
                      <dd>{clip.groupId}</dd>
                      <dt className="text-muted-foreground">group mates</dt>
                      <dd>{mates.join(" ") || "—"}</dd>
                      <dt className="text-muted-foreground">note</dt>
                      <dd>{clip.note || "—"}</dd>
                      <dt className="text-muted-foreground">decidedBy</dt>
                      <dd>{clip.decidedBy}</dd>
                      <dt className="text-muted-foreground">statusReason</dt>
                      <dd>{clip.statusReason || "—"}</dd>
                      {clip.script ? (
                        <>
                          <dt className="text-muted-foreground">script line</dt>
                          <dd data-testid="clip-script-line">
                            {clip.script.line}: {clip.script.text}
                          </dd>
                          <dt className="text-muted-foreground">match</dt>
                          <dd data-testid="clip-script-score">{clip.script.score.toFixed(2)}</dd>
                        </>
                      ) : null}
                      <dt className="text-muted-foreground">source</dt>
                      <dd>
                        {formatTimestamp(clip.sourceStart)}–{formatTimestamp(clip.sourceEnd)}
                      </dd>
                      <dt className="text-muted-foreground">parentIds</dt>
                      <dd>{clip.parentIds.join(" ") || "—"}</dd>
                      {Object.entries(clip.llm ?? {}).map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt className="text-muted-foreground">llm.{key}</dt>
                          <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
                        </div>
                      ))}
                    </dl>
                    <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void copyJson()}>
                      <Copy className="size-3.5" />
                      {studioCopy.copyJson}
                    </Button>
                    <button type="button" className="mt-2 block text-left underline" onClick={() => setRawOpen((open) => !open)}>
                      {studioCopy.rawJson}
                    </button>
                    {rawOpen ? (
                      <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2">{JSON.stringify(clip, null, 2)}</pre>
                    ) : null}
                  </section>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 p-8 text-center" data-testid="studio-empty">
                {projectStatus === "analyzing" ? (
                  <>
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{statusMessage || studioCopy.analyzing}</p>
                  </>
                ) : projectStatus === "error" ? (
                  <>
                    <p className="text-sm text-destructive">{statusMessage || studioCopy.analyzeFailed}</p>
                    <Button type="button" onClick={onRetryAnalyze}>
                      {studioCopy.retry}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {statusMessage && projectStatus === "empty" ? studioCopy.readyToAnalyze : studioCopy.noClipSelected}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : null}
        {tab === "render" ? (
          <div className="flex flex-1 flex-col gap-3 p-6" data-testid="rendered-video">
            {selectedRender ? (
              <>
                <video className="max-h-[70vh] w-full bg-black" src={outputUrl(slug, selectedRender.name)} controls />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{selectedRender.name}</span>
                  <span>{selectedRender.quality}</span>
                  <span>{formatDuration(selectedRender.duration)}</span>
                  <span>{selectedRender.size ? formatSize(selectedRender.size) : ""}</span>
                  <span>{selectedRender.createdAt ?? ""}</span>
                  <select
                    className="rounded-md border border-input bg-background px-2 py-1"
                    value={selectedRender.name}
                    onChange={(event) => onSelectRender(event.target.value)}
                  >
                    {renders.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No renders yet.</p>
            )}
          </div>
        ) : null}
        {tab === "source" ? (
          <div className="flex flex-1 flex-col p-6">
            <video className="max-h-[80vh] w-full bg-black" src={sourceUrl(slug)} controls />
          </div>
        ) : null}
      </div>
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup>
            <DialogTitle>{studioCopy.discardCuts}</DialogTitle>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDiscardOpen(false)}>
                {studioCopy.edit}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setCuts([]);
                  setEditing(false);
                  setDiscardOpen(false);
                  setCutError(null);
                }}
              >
                {studioCopy.cancel}
              </Button>
            </div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    </main>
  );
}

export function previewTabClass(active: boolean) {
  return cn(active ? "bg-primary text-primary-foreground" : "");
}
