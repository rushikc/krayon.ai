import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import {
  type AnalysisTimings,
  type ConfirmationItem,
  type StudioClip,
  type StudioProject,
  type StudioSettings,
  StudioConflictError,
  StudioNotFoundError,
  analyze,
  answerConfirmation,
  applyOps,
  cancelAnalyze,
  cancelRender,
  isAnalysisRunningError,
  deleteProject,
  eventsUrl,
  getProject,
  getTranscript,
  lintProject,
  listConfirmations,
  listOutputs,
  reanalyze,
  redo,
  renderStatus,
  resetStatus,
  startRender,
  undo,
  updateScript,
  updateSettings,
} from "@/lib/api/studio-client";
import { formatProgressLabel, formatTimestamp } from "@/lib/format";
import { studioClipIssueLabel } from "@/lib/delivery-issue";
import { resolveAnalysisDurationSeconds } from "@/lib/studio-analysis-duration";
import { clipMatchesFilter, type ClipStatusFilter } from "@/lib/studio-clip";
import { studioCopy } from "@/lib/studio-copy";
import { toast } from "@/stores/toast-store";

import {
  applyStudioPhase,
  applyTimingsToSteps,
  initialStudioSteps,
  markActiveStepError,
  type StudioPipelineStep,
  type StudioRunMode,
} from "@/lib/studio-analysis-steps";
import { StudioClipsPanel } from "@/pages/studio/StudioClipsPanel";
import { StudioConfirmDialog } from "@/pages/studio/StudioConfirmDialog";
import { StudioControlsPanel } from "@/pages/studio/StudioControlsPanel";
import { StudioPreviewPanel, type PreviewTab, type RenderManifest } from "@/pages/studio/StudioPreviewPanel";
import { StudioStepIndicator } from "@/pages/studio/StudioStepIndicator";

function tabForRender(name: string, quality?: string): PreviewTab {
  if (quality === "audio" || name.endsWith(".wav") || name.startsWith("audio-")) return "audio";
  if (quality === "final" || name.startsWith("final-")) return "final";
  return "render";
}

function sourceName(sourcePath: string | null | undefined): string {
  if (!sourcePath) return "studio";
  const parts = sourcePath.split(/[/\\]/);
  return parts[parts.length - 1] || sourcePath;
}

function renderStorageKey(slug: string) {
  return `krayon-studio-render:${slug}`;
}

export function StudioWorkspace({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const [project, setProject] = useState<StudioProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<{ code: string; message: string; clipId?: string }[]>([]);
  const [asks, setAsks] = useState<ConfirmationItem[]>([]);
  const [highlightAsk, setHighlightAsk] = useState<string | null>(null);
  const [busyAsk, setBusyAsk] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ClipStatusFilter>("all");
  const [tab, setTab] = useState<PreviewTab>("clip");
  const [autoPlayToken, setAutoPlayToken] = useState(0);
  const [render, setRender] = useState<{ id: string; message: string; ratio: number; outputName?: string; status?: string } | null>(null);
  const [renders, setRenders] = useState<RenderManifest[]>([]);
  const [activeRenderName, setActiveRenderName] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);
  const [analysisSteps, setAnalysisSteps] = useState<StudioPipelineStep[]>([]);
  const [analysisStartedAt, setAnalysisStartedAt] = useState<number | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const playingRef = useRef(false);
  const editingRef = useRef(false);
  const autoAnalyze = useRef<string | null>(null);
  const analysisStatusSynced = useRef(false);
  const analysisPull = useRef(false);
  const stepsHydrated = useRef(false);
  const analyzeInFlightRef = useRef(false);
  const [analyzeInFlight, setAnalyzeInFlight] = useState(false);
  const revisionRef = useRef(0);

  function pipelineOf(next: StudioProject): "transcript" | "scripted" {
    if (next.meta.lastPipeline === "scripted" || next.pipeline === "scripted") return "scripted";
    if ((next.meta.scriptLineCount ?? 0) > 0 && next.pipeline !== "transcript") return "scripted";
    return "transcript";
  }

  function hydrateSteps(next: StudioProject, mode: StudioRunMode = "analyze") {
    const snap = next.meta.settings?.snapToAudio !== false;
    let steps = initialStudioSteps(pipelineOf(next), snap, mode, Boolean(next.hasTranscript));
    const phase = next.lastPhase || "extracting";
    steps = applyStudioPhase(steps, phase, next.lastPhaseRatio ?? 0, next.lastPhaseMessage ?? studioCopy.startingAnalysis);
    steps = applyTimingsToSteps(steps, next.meta.analysisTimings);
    setAnalysisSteps(steps);
    const started = next.analysisStartedAt ?? next.meta.analysisStartedAt;
    setAnalysisStartedAt(started ? Date.parse(started) : Date.now());
    stepsHydrated.current = true;
  }

  const analysisDurationSeconds = useMemo(
    () => (project ? resolveAnalysisDurationSeconds(project) : null),
    [project],
  );

  const settings: StudioSettings = project?.meta.settings ?? {
    silenceThreshold: 0.4,
    pad: 0.05,
    similarityThreshold: 0.7,
    language: "auto",
    groupingMode: "timeline",
  };

  async function refresh() {
    const next = await getProject(slug);
    revisionRef.current = next.revision;
    setProject(next);
    void lintProject(slug)
      .then((lint) => setWarnings(lint.warnings))
      .catch(() => setWarnings([]));
    void listConfirmations(slug, "all")
      .then((listed) => setAsks(listed.items))
      .catch(() => setAsks([]));
    void listOutputs(slug)
      .then((outputs) => setRenders(outputs.manifests))
      .catch(() => undefined);
    return next;
  }

  useEffect(() => {
    stepsHydrated.current = false;
    analysisStatusSynced.current = false;
    void refresh().catch((err: unknown) => {
      if (err instanceof StudioNotFoundError) {
        navigate("/studio", { state: { notice: studioCopy.projectDeleted } });
        return;
      }
      setError(err instanceof Error ? err.message : "Load failed");
    });
    const stored = sessionStorage.getItem(renderStorageKey(slug));
    if (stored) {
      void renderStatus(slug, stored)
        .then((status) => {
          setRender({
            id: stored,
            message: status.message,
            ratio: status.ratio,
            outputName: status.outputName,
            status: status.status,
          });
        })
        .catch(() => sessionStorage.removeItem(renderStorageKey(slug)));
    }
    const source = new EventSource(eventsUrl(slug));
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as {
        type?: string;
        message?: string;
        ratio?: number;
        renderId?: string;
        outputName?: string;
        phase?: string;
        id?: string;
        status?: string;
        timings?: AnalysisTimings;
      };
      if (data.type === "confirmation_created" && data.id) {
        setHighlightAsk(data.id);
        void refresh().catch(() => undefined);
      }
      if (data.type === "confirmation_resolved" || data.type === "confirmation_cancelled") {
        setBusyAsk(null);
        void refresh().catch(() => undefined);
      }
      if (data.type === "deleted") {
        navigate("/studio", { state: { notice: studioCopy.projectDeleted } });
        return;
      }
      if (data.type === "progress") {
        setAnalysisProgress(formatProgressLabel(data.message, data.ratio));
        if (!analysisStatusSynced.current && !analysisPull.current) {
          analysisPull.current = true;
          void refresh()
            .then((next) => {
              if (next && next.status !== "empty") analysisStatusSynced.current = true;
            })
            .catch(() => undefined)
            .finally(() => {
              analysisPull.current = false;
            });
        }
        if (data.phase) {
          setAnalysisSteps((current) => {
            const next = applyStudioPhase(current, data.phase!, data.ratio ?? 0, data.message);
            return data.timings ? applyTimingsToSteps(next, data.timings) : next;
          });
        }
      }
      if (data.type === "status") {
        setAnalysisProgress(data.message ?? null);
        if (data.phase === "error" || data.status === "error") {
          setAnalysisError(data.message ?? studioCopy.analyzeFailed);
          setAnalysisSteps((current) => markActiveStepError(current, data.message ?? studioCopy.analyzeFailed));
        }
        void refresh().catch(() => undefined);
      }
      if (data.type === "snapshot") {
        void refresh().catch((err: unknown) => {
          if (err instanceof StudioNotFoundError) {
            navigate("/studio", { state: { notice: studioCopy.projectDeleted } });
          }
        });
      }
      if (data.type === "revision") {
        setAnalysisProgress(null);
        void refresh().catch(() => undefined);
      }
      if (data.type === "render") {
        setRender((current) => ({
          id: data.renderId ?? current?.id ?? "",
          message: data.message ?? "",
          ratio: data.ratio ?? 0,
          outputName: data.outputName ?? current?.outputName,
          status: data.phase,
        }));
        if (data.renderId) sessionStorage.setItem(renderStorageKey(slug), data.renderId);
        if (data.phase === "done" && data.outputName) {
          sessionStorage.removeItem(renderStorageKey(slug));
          setActiveRenderName(data.outputName);
          void listOutputs(slug).then((result) => setRenders(result.manifests)).catch(() => undefined);
          if (playingRef.current) toast(studioCopy.renderReady);
          else setTab(tabForRender(data.outputName));
        }
        if (data.phase === "cancelled" || data.phase === "error") {
          sessionStorage.removeItem(renderStorageKey(slug));
        }
      }
    };
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const clips = project?.clips ?? [];
  const groups = project?.groups ?? [];
  const visible = useMemo(
    () =>
      groups.flatMap((group) =>
        group.clipIds
          .map((id) => clips.find((clip) => clip.id === id))
          .filter((clip): clip is StudioClip => clip != null && clipMatchesFilter(clip, filter)),
      ),
    [clips, filter, groups],
  );

  const selected = clips.find((clip) => clip.id === selectedClipId) ?? null;

  function selectClip(id: string, play = false) {
    setSelectedClipId(id);
    setTab("clip");
    if (play) setAutoPlayToken((token) => token + 1);
  }

  function moveSelection(delta: number) {
    if (visible.length === 0) return;
    const index = visible.findIndex((clip) => clip.id === selectedClipId);
    const next = visible[Math.min(visible.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta))];
    if (next) selectClip(next.id);
  }

  function applyDecisionLocal(current: StudioProject, clipId: string, op: "select" | "reject"): StudioProject {
    const status = (op === "select" ? "selected" : "rejected") as StudioClip["status"];
    const clips = current.clips.map((clip) =>
      clip.id === clipId ? { ...clip, status, decidedBy: "human" as const } : clip,
    );
    const clip = clips.find((item) => item.id === clipId);
    let order = current.order.filter((id) => id !== clipId);
    if (op === "select" && clip) {
      const index = order.findIndex((id) => {
        const other = clips.find((item) => item.id === id);
        return other != null && other.sourceStart > clip.sourceStart;
      });
      order = index === -1 ? [...order, clipId] : [...order.slice(0, index), clipId, ...order.slice(index)];
    }
    return { ...current, clips, order };
  }

  function decide(clipId: string, op: "select" | "reject") {
    if (!clipId) return;
    setProject((current) => (current ? applyDecisionLocal(current, clipId, op) : current));
    const base = revisionRef.current;
    void applyOps(slug, base, [{ op, clipId }], op)
      .then((result) => {
        revisionRef.current = result.revision;
        setProject((current) =>
          current
            ? { ...current, revision: result.revision, order: result.order ?? current.order }
            : current,
        );
      })
      .catch(() => {
        toast(studioCopy.decisionFailed);
        void refresh().catch(() => undefined);
      });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelection(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSelection(1);
      }
      if (event.key === " ") {
        event.preventDefault();
        setAutoPlayToken((token) => token + 1);
        return;
      }
      if (editingRef.current) return;
      if (event.key === "a" || event.key === "A") {
        event.preventDefault();
        if (selectedClipId) void decide(selectedClipId, "select");
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        if (selectedClipId) void decide(selectedClipId, "reject");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selectedDuration = (project?.order ?? [])
    .map((id) => clips.find((clip) => clip.id === id)?.duration ?? 0)
    .reduce((sum, value) => sum + value, 0);
  const renderBusy = render?.status === "rendering" || project?.status === "rendering";
  const analysisBusy = project?.status === "analyzing" || renderBusy || analyzeInFlight;

  async function attachToRunningAnalysis(mode: StudioRunMode = "analyze") {
    const next = await refresh();
    if (next) hydrateSteps(next, mode);
  }

  async function runAnalyze() {
    if (!project || analysisBusy || analyzeInFlightRef.current) return;
    analyzeInFlightRef.current = true;
    setAnalyzeInFlight(true);
    setError(null);
    setAnalysisError(null);
    setAnalysisProgress(studioCopy.startingAnalysis);
    hydrateSteps(project, "analyze");
    try {
      await analyze(slug, project.revision);
      await refresh();
    } catch (err) {
      if (err instanceof StudioNotFoundError) {
        navigate("/studio", { state: { notice: studioCopy.projectDeleted } });
        return;
      }
      if (isAnalysisRunningError(err)) {
        await attachToRunningAnalysis("analyze").catch(() => undefined);
        return;
      }
      const message = err instanceof Error ? err.message : "Analyze failed";
      setError(message);
      setAnalysisError(message);
      setAnalysisSteps((current) => markActiveStepError(current, message));
      await refresh().catch(() => undefined);
    } finally {
      analyzeInFlightRef.current = false;
      setAnalyzeInFlight(false);
    }
  }

  useEffect(() => {
    if (!project) return;
    if (autoAnalyze.current === slug) return;
    if (project.clips.length > 0) return;
    if (!project.meta.sourcePath) return;
    if (project.status !== "empty") return;
    autoAnalyze.current = slug;
    void runAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, slug]);

  useEffect(() => {
    if (!project) return;
    if (project.status === "analyzing" && !stepsHydrated.current) {
      hydrateSteps(project, project.meta.statusMessage === "retranscribe" ? "retranscribe" : project.meta.statusMessage === "regroup" ? "regroup" : project.hasTranscript ? "resegment" : "analyze");
    }
    if (project.status === "ready") {
      stepsHydrated.current = false;
    }
  }, [project]);

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
            activeId="audio"
            videoEnabled={project?.status === "ready" && (project.order.length ?? 0) > 0}
            onAudioClick={() => navigate(`/studio/${slug}`)}
            onVideoClick={() => navigate(`/studio/${slug}/video`)}
          />
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={deleting}
            onClick={() => setDeleteOpen(true)}
          >
            {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            {studioCopy.delete}
          </Button>
        </div>
      }
    >
      {error ? <p className="absolute left-4 top-12 z-10 text-xs text-destructive">{error}</p> : null}
      <StudioClipsPanel
        clips={clips}
        groups={groups}
        selectedClipId={selectedClipId}
        filter={filter}
        onFilterChange={setFilter}
        onSelect={(id) => selectClip(id, false)}
        onPlay={(id) => selectClip(id, true)}
        onDecide={(id, op) => void decide(id, op)}
        projectStatus={project?.status}
        statusMessage={project?.meta.statusMessage}
      />
      <StudioPreviewPanel
        slug={slug}
        clip={selected}
        clips={clips}
        groups={groups}
        pad={settings.pad}
        tab={tab}
        onTabChange={setTab}
        conflictError={conflictError}
        renders={renders}
        activeRenderName={activeRenderName}
        onSelectRender={(name) => {
          setActiveRenderName(name);
          const item = renders.find((entry) => entry.name === name);
          setTab(tabForRender(name, item?.quality));
        }}
        onAccept={() => selected && void decide(selected.id, "select")}
        onReject={() => selected && void decide(selected.id, "reject")}
        onPrev={() => moveSelection(-1)}
        onNext={() => moveSelection(1)}
        autoPlayToken={autoPlayToken}
        playingRef={playingRef}
        projectStatus={project?.status}
        analysisActive={analyzeInFlight || project?.status === "analyzing"}
        statusMessage={analysisProgress ?? project?.meta.statusMessage}
        onRetryAnalyze={() => void runAnalyze()}
        onResetStatus={() => {
          void resetStatus(slug).then(() => refresh());
        }}
        onCancelAnalyze={() => {
          void cancelAnalyze(slug).then(() => refresh());
        }}
        analysisSteps={analysisSteps}
        analysisStartedAt={analysisStartedAt}
        analysisError={analysisError}
        onEditingChange={(value) => {
          editingRef.current = value;
        }}
        onStayOnClip={(id) => setSelectedClipId(id)}
        onUndo={() => void undo(slug).then(refresh)}
        onRedo={() => void redo(slug).then(refresh)}
        onSaveCuts={async (clipId, at) => {
          if (!project) return false;
          setConflictError(null);
          try {
            await applyOps(slug, project.revision, [{ op: "splitMany", clipId, at }], "split");
            const next = await refresh();
            const first = next.clips.find((item) => item.parentIds[0] === clipId);
            if (first) selectClip(first.id);
            toast(studioCopy.splitToast(at.length + 1));
            return true;
          } catch (err) {
            if (err instanceof StudioConflictError) {
              setConflictError(studioCopy.splitConflict);
              await refresh();
              return false;
            }
            setError(err instanceof Error ? err.message : "Split failed");
            return false;
          }
        }}
      />
      <StudioControlsPanel
        asks={asks}
        highlightAsk={highlightAsk}
        busyAsk={busyAsk}
        onAnswer={(item, optionId, askNote) => {
          setBusyAsk(item.id);
          void answerConfirmation(slug, item.id, optionId, askNote)
            .then(() => refresh())
            .catch((err: unknown) => setError(err instanceof Error ? err.message : "Answer failed"))
            .finally(() => setBusyAsk(null));
        }}
        onSelectClip={(id) => selectClip(id, false)}
        onDismissAsk={() => setHighlightAsk(null)}
        settings={settings}
        onSaveSettings={(next) => {
          void updateSettings(slug, next).then(() => refresh());
        }}
        selectedCount={project?.order.length ?? 0}
        selectedClock={formatTimestamp(selectedDuration)}
        warnings={warnings}
        onSelectWarning={(id) => selectClip(id, false)}
        renderBusy={Boolean(renderBusy)}
        renderProgress={render}
        onRender={(quality) => {
          void startRender(slug, quality).then((job) => {
            sessionStorage.setItem(renderStorageKey(slug), job.renderId);
            setRender({ id: job.renderId, message: "Starting render", ratio: 0, outputName: job.outputName, status: "rendering" });
          });
        }}
        onCancelRender={() => {
          if (!render?.id) return;
          void cancelRender(slug, render.id).then(() => {
            sessionStorage.removeItem(renderStorageKey(slug));
            setRender((current) => (current ? { ...current, status: "cancelled", message: "cancelled" } : current));
          });
        }}
        renders={renders}
        onPlayRender={(name) => {
          setActiveRenderName(name);
          const item = renders.find((entry) => entry.name === name);
          setTab(tabForRender(name, item?.quality));
        }}
        onLoadTranscript={() => getTranscript(slug)}
        clipCount={clips.length}
        hasTranscript={Boolean(project?.hasTranscript)}
        hasSource={Boolean(project?.meta.sourcePath)}
        issueLabel={studioClipIssueLabel(selected?.label)}
        analysisBusy={Boolean(analysisBusy)}
        analysisMessage={analysisProgress ?? (project?.status === "analyzing" ? project.meta.statusMessage : null)}
        analysisDurationSeconds={analysisDurationSeconds}
        analysisTimings={project?.meta.analysisTimings}
        onAnalyze={() => void runAnalyze()}
        script={project?.script ?? ""}
        onSaveScript={(next) => {
          if (!project) return;
          void updateScript(slug, project.revision, next)
            .then(() => refresh())
            .catch((err: unknown) => setError(err instanceof Error ? err.message : "Save script failed"));
        }}
        lastPipeline={project?.meta.lastPipeline}
        scriptLineCount={project?.meta.scriptLineCount ?? 0}
        needsRebuild={project?.meta.needsRebuild}
        rebuildReason={project?.meta.rebuildReason}
        detectedLanguage={project?.meta.detectedLanguage}
        matchedLines={(project?.groups ?? []).filter((group) => group.scriptLine != null && group.clipIds.length > 0).length}
        missingLines={(project?.groups ?? []).filter((group) => group.scriptLine != null && group.clipIds.length === 0).length}
        onContinueToVisuals={
          project?.status === "ready" && (project.order.length ?? 0) > 0
            ? () => navigate(`/studio/${slug}/video`)
            : undefined
        }
        onRebuild={(pipeline) => {
          if (!project || analyzeInFlightRef.current) return;
          analyzeInFlightRef.current = true;
          setAnalyzeInFlight(true);
          const scripted = pipeline === "scripted";
          setError(null);
          setAnalysisError(null);
          hydrateSteps(project, "resegment");
          void reanalyze(slug, project.revision, {
            mode: "resegment",
            reset: scripted ? false : true,
            ...(pipeline ? { pipeline } : {}),
          })
            .then(() => refresh())
            .catch((err: unknown) => {
              if (isAnalysisRunningError(err)) {
                void attachToRunningAnalysis("resegment");
                return;
              }
              setError(err instanceof Error ? err.message : "Rebuild failed");
            })
            .finally(() => {
              analyzeInFlightRef.current = false;
              setAnalyzeInFlight(false);
            });
        }}
      />
      <StudioConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={studioCopy.deleteConfirmTitle(project?.meta.title ?? slug)}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              {studioCopy.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                setDeleting(true);
                void deleteProject(slug)
                  .then(() => navigate("/studio"))
                  .catch((err: unknown) => {
                    setDeleting(false);
                    setError(err instanceof Error ? err.message : "Delete failed");
                    setDeleteOpen(false);
                  });
              }}
            >
              {studioCopy.delete}
            </Button>
          </>
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">{studioCopy.deleteConfirm}</p>
      </StudioConfirmDialog>
    </AppShell>
  );
}
