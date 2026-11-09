import { Check, GripHorizontal, Pause, Play, Redo2, SkipBack, SkipForward, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import {
  applyOps,
  cutAudioUrl,
  eventsUrl,
  getClipPeaks,
  getProject,
  redo,
  undo,
  type StudioClip,
  type StudioProject,
} from "@/lib/api/studio-client";
import { isZoomInKey, isZoomOutKey } from "@/lib/canvas-keyboard";
import { formatTimestamp } from "@/lib/format";
import { clipPlayDuration, takeLabel, validateCut } from "@/lib/studio-clip";
import { studioCopy } from "@/lib/studio-copy";
import { toast } from "@/stores/toast-store";

import {
  EDIT_ZOOM_MAX,
  EDIT_ZOOM_MIN,
  EDIT_ZOOM_STEP,
  nextEditZoom,
  StudioEditWaveform,
  type EditWaveSegment,
} from "@/pages/studio/StudioEditWaveform";
import { StudioStepIndicator } from "@/pages/studio/StudioStepIndicator";

const NUDGE = 3;
const EMPTY_CUTS: number[] = [];
const BOTTOM_KEY = "krayon-studio-edit-bottom";
const BOTTOM_DEFAULT = 200;
const BOTTOM_MIN = 96;

function maxBottomHeight() {
  if (typeof window === "undefined") return 400;
  return Math.round(window.innerHeight * 0.45);
}

function clampBottomHeight(value: number) {
  return Math.min(maxBottomHeight(), Math.max(BOTTOM_MIN, value));
}

function readBottomHeight() {
  try {
    const raw = localStorage.getItem(BOTTOM_KEY);
    if (raw == null || raw.trim() === "") return BOTTOM_DEFAULT;
    const stored = Number(raw);
    if (!Number.isFinite(stored)) return BOTTOM_DEFAULT;
    return clampBottomHeight(stored);
  } catch {
    return BOTTOM_DEFAULT;
  }
}

function persistBottomHeight(value: number) {
  try {
    localStorage.setItem(BOTTOM_KEY, String(value));
  } catch {
    /* ignore */
  }
}

function sourceName(sourcePath: string | null | undefined): string {
  if (!sourcePath) return "studio";
  const parts = sourcePath.split(/[/\\]/);
  return parts[parts.length - 1] || "studio";
}

function timelineClips(project: StudioProject, showAll: boolean): StudioClip[] {
  if (showAll) {
    return [...project.clips].sort((left, right) => left.sourceStart - right.sourceStart || left.id.localeCompare(right.id));
  }
  return project.order
    .map((id) => project.clips.find((clip) => clip.id === id))
    .filter((clip): clip is StudioClip => clip != null && clip.status === "selected");
}

function playheadToSource(clip: StudioClip, offset: number): number | null {
  const before = clip.silenceBefore ?? 0;
  const after = clip.silenceAfter ?? 0;
  const speech = Math.max(0.01, clipPlayDuration(clip) - before - after);
  if (offset < before - 1e-3) return null;
  if (offset > before + speech + 1e-3) return null;
  const ratio = Math.min(1, Math.max(0, (offset - before) / speech));
  return clip.sourceStart + ratio * (clip.sourceEnd - clip.sourceStart);
}

export function StudioEditPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<StudioProject | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [peaksById, setPeaksById] = useState<Record<string, number[]>>({});
  const [cutsById, setCutsById] = useState<Record<string, number[]>>({});
  const [cutError, setCutError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [prefix, setPrefix] = useState(0);
  const [suffix, setSuffix] = useState(0);
  const [silenceBeforeDraft, setSilenceBeforeDraft] = useState(0);
  const [silenceAfterDraft, setSilenceAfterDraft] = useState(0);
  const [draggingSilence, setDraggingSilence] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [bottomHeight, setBottomHeight] = useState(readBottomHeight);
  const audioRef = useRef<HTMLAudioElement>(null);
  const baselineRef = useRef<{ start: number; end: number } | null>(null);
  const lastWaveClickedId = useRef<string | null>(null);
  const scrubbing = useRef(false);
  const bottomDrag = useRef<{ startY: number; startHeight: number } | null>(null);
  const currentTimeRef = useRef(0);
  const selectedClipIdRef = useRef<string | null>(null);
  const lastClockRef = useRef(formatTimestamp(0));
  const lastUiSyncAtRef = useRef(0);
  currentTimeRef.current = currentTime;
  selectedClipIdRef.current = selectedClipId;

  async function refresh() {
    if (!slug) return null;
    const next = await getProject(slug);
    setProject(next);
    return next;
  }

  useEffect(() => {
    function onResize() {
      setBottomHeight((current) => clampBottomHeight(current));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!slug) return;
    void refresh().catch(() => navigate("/studio", { replace: true }));
    const source = new EventSource(eventsUrl(slug));
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as { type?: string };
      if (data.type === "revision" || data.type === "snapshot") void refresh().catch(() => undefined);
    };
    return () => source.close();
  }, [slug, navigate]);

  const clips = useMemo(() => (project ? timelineClips(project, showAll) : []), [project, showAll]);
  const selected = project?.clips.find((clip) => clip.id === selectedClipId) ?? clips[0] ?? null;

  useEffect(() => {
    if (selected && !clips.some((clip) => clip.id === selected.id) && clips[0]) {
      setSelectedClipId(clips[0].id);
    } else if (!selectedClipId && clips[0]) {
      setSelectedClipId(clips[0].id);
    }
  }, [clips, selected, selectedClipId]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    void Promise.all(
      clips
        .filter((clip) => peaksById[clip.id] == null)
        .map(async (clip) => {
          const result = await getClipPeaks(slug, clip.id, 400, 0);
          return [clip.id, result.peaks] as const;
        }),
    ).then((entries) => {
      if (cancelled || entries.length === 0) return;
      setPeaksById((current) => ({ ...current, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
  }, [slug, clips.map((clip) => clip.id).join(",")]);

  useEffect(() => {
    if (!selected) {
      baselineRef.current = null;
      return;
    }
    baselineRef.current = { start: selected.sourceStart, end: selected.sourceEnd };
    setPrefix(0);
    setSuffix(0);
    setSilenceBeforeDraft(selected.silenceBefore ?? 0);
    setSilenceAfterDraft(selected.silenceAfter ?? 0);
    setCutError(null);
  }, [selected?.id, selected?.sourceStart, selected?.sourceEnd, selected?.silenceBefore, selected?.silenceAfter]);

  const segments: EditWaveSegment[] = useMemo(
    () =>
      clips.map((clip) => ({
        clipId: clip.id,
        status: clip.status,
        duration: clipPlayDuration(clip),
        silenceBefore:
          draggingSilence && clip.id === selected?.id ? Math.max(0, silenceBeforeDraft) : (clip.silenceBefore ?? 0),
        silenceAfter:
          draggingSilence && clip.id === selected?.id ? Math.max(0, silenceAfterDraft) : (clip.silenceAfter ?? 0),
        peaks: peaksById[clip.id] ?? [],
        sourceStart: clip.sourceStart,
        sourceEnd: clip.sourceEnd,
        label: takeLabel(clip, project?.clips ?? clips),
        draftSilence: draggingSilence && clip.id === selected?.id,
      })),
    [
      clips,
      draggingSilence,
      peaksById,
      project?.clips,
      draggingSilence ? selected?.id : null,
      draggingSilence ? silenceAfterDraft : 0,
      draggingSilence ? silenceBeforeDraft : 0,
    ],
  );

  function offsetOf(clipId: string): number {
    let cursor = 0;
    for (const clip of clips) {
      if (clip.id === clipId) return cursor;
      cursor += clipPlayDuration(clip);
    }
    return 0;
  }

  const totalDuration = useMemo(
    () => clips.reduce((sum, clip) => sum + clipPlayDuration(clip), 0),
    [clips],
  );

  const cuts = (selected && cutsById[selected.id]) || EMPTY_CUTS;

  function clipAtTime(time: number): { clip: StudioClip; start: number; index: number } | null {
    if (clips.length === 0) return null;
    let cursor = 0;
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index]!;
      const duration = clipPlayDuration(clip);
      if (time < cursor + duration - 1e-6 || index === clips.length - 1) {
        return { clip, start: cursor, index };
      }
      cursor += duration;
    }
    return null;
  }

  function syncPlayhead(time: number) {
    setCurrentTime(time);
    const hit = clipAtTime(time);
    if (hit && hit.clip.id !== selectedClipIdRef.current) setSelectedClipId(hit.clip.id);
  }

  function getMediaTime() {
    const mediaTime = audioRef.current?.currentTime;
    if (mediaTime != null && Number.isFinite(mediaTime)) return mediaTime;
    return currentTimeRef.current;
  }

  function onPlayingFrame(time: number) {
    const clock = formatTimestamp(time);
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (clock !== lastClockRef.current || now - lastUiSyncAtRef.current >= 125) {
      lastClockRef.current = clock;
      lastUiSyncAtRef.current = now;
      setCurrentTime(time);
    }
    const hit = clipAtTime(time);
    if (hit && hit.clip.id !== selectedClipIdRef.current) setSelectedClipId(hit.clip.id);
  }

  function skipPrevious() {
    const hit = clipAtTime(currentTime);
    if (!hit) return;
    if (currentTime - hit.start > 0.05) {
      seek(hit.start);
      return;
    }
    if (hit.index === 0) return;
    const prev = clips[hit.index - 1]!;
    seek(offsetOf(prev.id));
  }

  function skipNext() {
    const hit = clipAtTime(currentTime);
    if (!hit || hit.index >= clips.length - 1) return;
    const next = clips[hit.index + 1]!;
    seek(offsetOf(next.id));
  }

  function onWavePointerDown(clipId: string, time: number) {
    if (lastWaveClickedId.current !== clipId) {
      lastWaveClickedId.current = clipId;
      scrubbing.current = false;
      setSelectedClipId(clipId);
      seek(offsetOf(clipId));
      return;
    }
    scrubbing.current = true;
    seek(time);
  }

  function onWavePointerMove(time: number) {
    if (!scrubbing.current) return;
    seek(time);
  }

  function onWavePointerUp() {
    scrubbing.current = false;
  }

  function onBottomPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    bottomDrag.current = { startY: event.clientY, startHeight: bottomHeight };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onBottomPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!bottomDrag.current) return;
    setBottomHeight(clampBottomHeight(bottomDrag.current.startHeight + (bottomDrag.current.startY - event.clientY)));
  }

  function onBottomPointerUp() {
    if (!bottomDrag.current) return;
    bottomDrag.current = null;
    setBottomHeight((current) => {
      persistBottomHeight(current);
      return current;
    });
  }

  function seek(time: number) {
    syncPlayhead(time);
    const audio = audioRef.current;
    if (audio && Number.isFinite(time)) {
      try {
        audio.currentTime = time;
      } catch {
        /* jsdom */
      }
    }
  }

  function addCutAtPlayhead() {
    const hit = clipAtTime(currentTime);
    if (!hit) return;
    const local = currentTime - hit.start;
    const at = playheadToSource(hit.clip, local);
    if (at == null) {
      setCutError(studioCopy.cutTooClose);
      return;
    }
    const pending = cutsById[hit.clip.id] ?? [];
    const error = validateCut(at, hit.clip.sourceStart, hit.clip.sourceEnd, pending);
    if (error) {
      setCutError(studioCopy.cutTooClose);
      return;
    }
    setSelectedClipId(hit.clip.id);
    setCutsById((current) => ({
      ...current,
      [hit.clip.id]: [...pending, at].sort((left, right) => left - right),
    }));
    setCutError(null);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        addCutAtPlayhead();
      }
      if (event.key === " ") {
        event.preventDefault();
        void togglePlay();
      }
      if (isZoomInKey(event)) {
        event.preventDefault();
        setZoom((current) => nextEditZoom(current, 1));
      }
      if (isZoomOutKey(event)) {
        event.preventDefault();
        setZoom((current) => nextEditZoom(current, -1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  function pauseFromUser() {
    const audio = audioRef.current;
    if (audio && !audio.paused) audio.pause();
    setPlaying(false);
  }

  async function decide(op: "select" | "reject") {
    if (!slug || !project || !selected) return;
    await applyOps(slug, project.revision, [{ op, clipId: selected.id }], op);
    await refresh();
  }

  async function saveCuts() {
    if (!slug || !project || !selected || cuts.length === 0) return;
    const clipId = selected.id;
    try {
      await applyOps(slug, project.revision, [{ op: "splitMany", clipId, at: cuts }], "split");
      setCutsById((current) => ({ ...current, [clipId]: [] }));
      toast(studioCopy.splitToast(cuts.length + 1));
      await refresh();
    } catch {
      setCutError(studioCopy.splitConflict);
    }
  }

  async function commitPrefixSuffix() {
    if (!slug || !project || !selected || !baselineRef.current) return;
    if (prefix === 0 && suffix === 0) return;
    const start = baselineRef.current.start - prefix;
    const end = baselineRef.current.end + suffix;
    await applyOps(
      slug,
      project.revision,
      [{ op: "adjustBounds", clipId: selected.id, start, end, sampleAccurate: true }],
      "trim",
    );
    setPrefix(0);
    setSuffix(0);
    await refresh();
  }

  async function commitSilence(edge: "before" | "after", value: number) {
    if (!slug || !project || !selected) return;
    const ops: Array<Record<string, unknown>> = [];
    if (value < 0) {
      const eat = Math.min(NUDGE, -value);
      if (edge === "before") {
        ops.push({
          op: "adjustBounds",
          clipId: selected.id,
          start: selected.sourceStart + eat,
          end: selected.sourceEnd,
          sampleAccurate: true,
        });
        ops.push({ op: "setSilence", clipId: selected.id, before: eat, after: selected.silenceAfter ?? 0 });
      } else {
        ops.push({
          op: "adjustBounds",
          clipId: selected.id,
          start: selected.sourceStart,
          end: selected.sourceEnd - eat,
          sampleAccurate: true,
        });
        ops.push({ op: "setSilence", clipId: selected.id, before: selected.silenceBefore ?? 0, after: eat });
      }
    } else {
      ops.push({
        op: "setSilence",
        clipId: selected.id,
        before: edge === "before" ? value : (selected.silenceBefore ?? 0),
        after: edge === "after" ? value : (selected.silenceAfter ?? 0),
      });
    }
    await applyOps(slug, project.revision, ops, "trim");
    setDraggingSilence(false);
    await refresh();
  }

  if (!slug) return null;
  const src = project ? cutAudioUrl(slug, project.revision, showAll ? "all" : "selected") : "";
  const canEdit = clips.length > 0;
  const videoEnabled = project?.status === "ready" && (project.order.length ?? 0) > 0;
  const playheadHit = clipAtTime(currentTime);
  const skipPrevDisabled =
    !playheadHit || (playheadHit.index === 0 && currentTime - playheadHit.start <= 0.05);
  const skipNextDisabled = !playheadHit || playheadHit.index >= clips.length - 1;

  return (
    <AppShell
      showBack
      backTo="/studio"
      backLabel={studioCopy.backToLibrary}
      title={sourceName(project?.meta.sourcePath)}
      subtitle={project?.meta.title ?? slug}
      actions={
        <div className="flex items-center gap-2">
          <StudioStepIndicator
            activeId="edit"
            editEnabled={canEdit}
            videoEnabled={videoEnabled}
            onAudioClick={() => navigate(`/studio/${slug}`)}
            onEditClick={() => navigate(`/studio/${slug}/edit`)}
            onVideoClick={() => navigate(`/studio/${slug}/video`)}
          />
          <Button type="button" size="sm" disabled={!videoEnabled} onClick={() => navigate(`/studio/${slug}/video`)}>
            {studioCopy.continueToVisuals}
          </Button>
        </div>
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="studio-edit-page">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <Button
            type="button"
            size="sm"
            variant={showAll ? "default" : "outline"}
            aria-pressed={showAll}
            onClick={() => setShowAll((value) => !value)}
          >
            {studioCopy.showAllSegments}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={selected?.status === "selected" ? "default" : "outline"}
            aria-pressed={selected?.status === "selected"}
            disabled={!selected}
            onClick={() => void decide("select")}
          >
            <Check className="size-3.5" />
            {studioCopy.accept}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={selected?.status === "rejected" ? "destructive" : "outline"}
            aria-pressed={selected?.status === "rejected"}
            disabled={!selected}
            onClick={() => void decide("reject")}
          >
            <X className="size-3.5" />
            {studioCopy.reject}
          </Button>
          <Button type="button" variant="outline" size="sm" aria-label="Undo" onClick={() => slug && void undo(slug).then(refresh)}>
            <Undo2 className="size-3.5" />
            Undo
          </Button>
          <Button type="button" variant="outline" size="sm" aria-label="Redo" onClick={() => slug && void redo(slug).then(refresh)}>
            <Redo2 className="size-3.5" />
            Redo
          </Button>
          <p className="ml-auto font-mono text-sm tabular-nums text-muted-foreground">
            {formatTimestamp(currentTime)} / {formatTimestamp(totalDuration)}
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={studioCopy.previousClip}
              disabled={!canEdit || skipPrevDisabled}
              onClick={skipPrevious}
            >
              <SkipBack className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              className="size-12 rounded-full"
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => void togglePlay()}
              disabled={!canEdit}
            >
              {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={studioCopy.nextClip}
              disabled={!canEdit || skipNextDisabled}
              onClick={skipNext}
            >
              <SkipForward className="size-3.5" />
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={addCutAtPlayhead} disabled={!selected}>
              {studioCopy.addCut}
            </Button>
            <span className="text-xs text-muted-foreground">{studioCopy.pressS}</span>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={studioCopy.zoomOut}
              disabled={!canEdit || zoom <= 1}
              onClick={() => setZoom((current) => nextEditZoom(current, -1))}
            >
              <ZoomOut className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={studioCopy.zoomIn}
              disabled={!canEdit || zoom >= 16}
              onClick={() => setZoom((current) => nextEditZoom(current, 1))}
            >
              <ZoomIn className="size-3.5" />
            </Button>
            {cuts.length > 0 ? (
              <Button type="button" size="sm" onClick={() => void saveCuts()}>
                {studioCopy.saveCuts(cuts.length)}
              </Button>
            ) : null}
            {cutError ? <p className="text-xs text-destructive">{cutError}</p> : null}
            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">{zoom.toFixed(1)}×</span>
              <input
                type="range"
                min={EDIT_ZOOM_MIN}
                max={EDIT_ZOOM_MAX}
                step={EDIT_ZOOM_STEP}
                value={zoom}
                aria-label="Zoom"
                disabled={!canEdit}
                className="w-36"
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
          </div>
          {!canEdit ? (
            <p className="text-sm text-muted-foreground">{studioCopy.noSelectedClips}</p>
          ) : (
            <div className="flex min-h-[220px] flex-1 flex-col overflow-hidden">
              <StudioEditWaveform
                segments={segments}
                currentTime={currentTime}
                cuts={cuts}
                zoom={zoom}
                playing={playing}
                selectedClipId={selected?.id}
                getMediaTime={getMediaTime}
                onPlayingFrame={onPlayingFrame}
                onZoom={setZoom}
                onWavePointerDown={onWavePointerDown}
                onWavePointerMove={onWavePointerMove}
                onWavePointerUp={onWavePointerUp}
                onTogglePlay={() => void togglePlay()}
                onUserPause={pauseFromUser}
                isScrubbing={() => scrubbing.current}
                onRemoveCut={(at) => {
                  if (!selected) return;
                  setCutsById((current) => ({
                    ...current,
                    [selected.id]: (current[selected.id] ?? []).filter((cut) => cut !== at),
                  }));
                }}
              />
            </div>
          )}
          {src ? (
            <audio
              ref={audioRef}
              src={src}
              className="hidden"
              onTimeUpdate={(event) => syncPlayhead(event.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
          ) : null}
        </div>

        <div
          data-testid="edit-bottom-resize"
          className="relative h-2 shrink-0 cursor-row-resize"
          onPointerDown={onBottomPointerDown}
          onPointerMove={onBottomPointerMove}
          onPointerUp={onBottomPointerUp}
          onPointerCancel={onBottomPointerUp}
        >
          <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-border" />
          <GripHorizontal className="pointer-events-none absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>
        <div
          className="grid min-h-0 shrink-0 grid-cols-1 gap-4 overflow-y-auto border-t border-border px-4 py-3 md:grid-cols-2"
          style={{ height: bottomHeight }}
        >
          <section>
            <p className="mb-2 text-xs font-medium">{studioCopy.editTranscript}</p>
            <p className="text-sm leading-6" data-testid="edit-transcript">
              {selected?.text || "—"}
            </p>
          </section>
          <section className="space-y-3" data-testid="edit-sliders">
            <p className="text-xs font-medium">{studioCopy.editSettings}</p>
            <label className="block text-xs">
              {studioCopy.prefix}
              <input
                type="range"
                min={-NUDGE}
                max={NUDGE}
                step={0.05}
                value={prefix}
                className="mt-1 w-full"
                disabled={!selected}
                onChange={(event) => setPrefix(Number(event.target.value))}
                onPointerUp={() => void commitPrefixSuffix()}
              />
            </label>
            <label className="block text-xs">
              {studioCopy.suffix}
              <input
                type="range"
                min={-NUDGE}
                max={NUDGE}
                step={0.05}
                value={suffix}
                className="mt-1 w-full"
                disabled={!selected}
                onChange={(event) => setSuffix(Number(event.target.value))}
                onPointerUp={() => void commitPrefixSuffix()}
              />
            </label>
            <label className="block text-xs">
              {studioCopy.prefixSilence}
              <input
                type="range"
                min={-NUDGE}
                max={NUDGE}
                step={0.05}
                value={silenceBeforeDraft}
                className="mt-1 w-full"
                disabled={!selected}
                onPointerDown={() => setDraggingSilence(true)}
                onChange={(event) => setSilenceBeforeDraft(Number(event.target.value))}
                onPointerUp={(event) => void commitSilence("before", Number((event.target as HTMLInputElement).value))}
              />
            </label>
            <label className="block text-xs">
              {studioCopy.suffixSilence}
              <input
                type="range"
                min={-NUDGE}
                max={NUDGE}
                step={0.05}
                value={silenceAfterDraft}
                className="mt-1 w-full"
                disabled={!selected}
                onPointerDown={() => setDraggingSilence(true)}
                onChange={(event) => setSilenceAfterDraft(Number(event.target.value))}
                onPointerUp={(event) => void commitSilence("after", Number((event.target as HTMLInputElement).value))}
              />
            </label>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
