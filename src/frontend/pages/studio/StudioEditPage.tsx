import { Check, Pause, Play, Redo2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { clipPlayDuration, takeLabel, validateCut } from "@/lib/studio-clip";
import { studioCopy } from "@/lib/studio-copy";
import { toast } from "@/stores/toast-store";

import { StudioEditWaveform, type EditWaveSegment } from "@/pages/studio/StudioEditWaveform";
import { StudioStepIndicator } from "@/pages/studio/StudioStepIndicator";

const NUDGE = 3;

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
  const [cuts, setCuts] = useState<number[]>([]);
  const [cutError, setCutError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [prefix, setPrefix] = useState(0);
  const [suffix, setSuffix] = useState(0);
  const [silenceBeforeDraft, setSilenceBeforeDraft] = useState(0);
  const [silenceAfterDraft, setSilenceAfterDraft] = useState(0);
  const [draggingSilence, setDraggingSilence] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const baselineRef = useRef<{ start: number; end: number } | null>(null);

  async function refresh() {
    if (!slug) return null;
    const next = await getProject(slug);
    setProject(next);
    return next;
  }

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
      clips.map(async (clip) => {
        const result = await getClipPeaks(slug, clip.id, 400, 0);
        return [clip.id, result.peaks] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setPeaksById(Object.fromEntries(entries));
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
    setCuts([]);
    setCutError(null);
  }, [selected?.id, selected?.sourceStart, selected?.sourceEnd, selected?.silenceBefore, selected?.silenceAfter]);

  const segments: EditWaveSegment[] = clips.map((clip) => ({
    clipId: clip.id,
    status: clip.status,
    active: clip.id === selected?.id,
    duration: clipPlayDuration(clip),
    silenceBefore: clip.id === selected?.id ? Math.max(0, silenceBeforeDraft) : (clip.silenceBefore ?? 0),
    silenceAfter: clip.id === selected?.id ? Math.max(0, silenceAfterDraft) : (clip.silenceAfter ?? 0),
    peaks: peaksById[clip.id] ?? [],
    sourceStart: clip.sourceStart,
    sourceEnd: clip.sourceEnd,
    label: takeLabel(clip, project?.clips ?? clips),
    draftSilence: draggingSilence && clip.id === selected?.id,
  }));

  function offsetOf(clipId: string): number {
    let cursor = 0;
    for (const clip of clips) {
      if (clip.id === clipId) return cursor;
      cursor += clipPlayDuration(clip);
    }
    return 0;
  }

  function seek(time: number) {
    const audio = audioRef.current;
    setCurrentTime(time);
    if (audio && Number.isFinite(time)) {
      try {
        audio.currentTime = time;
      } catch {
        /* jsdom */
      }
    }
  }

  function addCutAtPlayhead() {
    if (!selected) return;
    const start = offsetOf(selected.id);
    const local = currentTime - start;
    const at = playheadToSource(selected, local);
    if (at == null) {
      setCutError(studioCopy.cutTooClose);
      return;
    }
    const error = validateCut(at, selected.sourceStart, selected.sourceEnd, cuts);
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
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        addCutAtPlayhead();
      }
      if (event.key === " ") {
        event.preventDefault();
        void togglePlay();
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

  async function decide(op: "select" | "reject") {
    if (!slug || !project || !selected) return;
    await applyOps(slug, project.revision, [{ op, clipId: selected.id }], op);
    await refresh();
  }

  async function saveCuts() {
    if (!slug || !project || !selected || cuts.length === 0) return;
    try {
      await applyOps(slug, project.revision, [{ op: "splitMany", clipId: selected.id, at: cuts }], "split");
      setCuts([]);
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

  return (
    <AppShell
      showBack
      backTo="/studio"
      backLabel={studioCopy.backToLibrary}
      title={sourceName(project?.meta.sourcePath)}
      subtitle={project?.meta.title ?? slug}
      actions={
        <StudioStepIndicator
          activeId="edit"
          editEnabled={canEdit}
          videoEnabled={videoEnabled}
          onAudioClick={() => navigate(`/studio/${slug}`)}
          onEditClick={() => navigate(`/studio/${slug}/edit`)}
          onVideoClick={() => navigate(`/studio/${slug}/video`)}
        />
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
          <div className="ml-auto">
            <Button type="button" size="sm" disabled={!videoEnabled} onClick={() => navigate(`/studio/${slug}/video`)}>
              {studioCopy.continueToVisuals}
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
          {!canEdit ? (
            <p className="text-sm text-muted-foreground">{studioCopy.noSelectedClips}</p>
          ) : (
            <StudioEditWaveform
              segments={segments}
              currentTime={currentTime}
              cuts={cuts}
              onSeek={seek}
              onSelectClip={setSelectedClipId}
              onRemoveCut={(at) => setCuts((current) => current.filter((cut) => cut !== at))}
            />
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => void togglePlay()} disabled={!canEdit}>
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              {playing ? "Pause" : "Play"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={addCutAtPlayhead} disabled={!selected}>
              {studioCopy.addCut}
            </Button>
            <span className="text-xs text-muted-foreground">{studioCopy.pressS}</span>
            {cuts.length > 0 ? (
              <Button type="button" size="sm" onClick={() => void saveCuts()}>
                {studioCopy.saveCuts(cuts.length)}
              </Button>
            ) : null}
            {cutError ? <p className="text-xs text-destructive">{cutError}</p> : null}
          </div>
          <audio
            ref={audioRef}
            src={src}
            className="hidden"
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        </div>

        <div className="grid min-h-[180px] shrink-0 grid-cols-1 gap-4 border-t border-border px-4 py-3 md:grid-cols-2">
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
