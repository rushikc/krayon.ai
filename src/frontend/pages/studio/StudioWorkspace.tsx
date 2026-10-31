import { Redo2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import {
  type ConfirmationItem,
  type StudioClip,
  type StudioProject,
  type StudioSettings,
  StudioConflictError,
  analyze,
  answerConfirmation,
  applyOps,
  cancelRender,
  eventsUrl,
  getProject,
  getTranscript,
  lintProject,
  listConfirmations,
  listOutputs,
  listSegments,
  reanalyze,
  redo,
  renderStatus,
  startRender,
  undo,
  updateSettings,
} from "@/lib/api/studio-client";
import { formatTimestamp } from "@/lib/format";
import { clipMatchesFilter, type ClipStatusFilter } from "@/lib/studio-clip";
import { studioCopy } from "@/lib/studio-copy";
import { toast } from "@/stores/toast-store";

import { StudioClipsPanel } from "@/pages/studio/StudioClipsPanel";
import { StudioControlsPanel } from "@/pages/studio/StudioControlsPanel";
import { StudioPreviewPanel, type PreviewTab, type RenderManifest } from "@/pages/studio/StudioPreviewPanel";
import { StudioStepIndicator } from "@/pages/studio/StudioStepIndicator";

function sourceName(sourcePath: string | null | undefined): string {
  if (!sourcePath) return "studio";
  const parts = sourcePath.split(/[/\\]/);
  return parts[parts.length - 1] || sourcePath;
}

function renderStorageKey(slug: string) {
  return `krayon-studio-render:${slug}`;
}

export function StudioWorkspace({ slug }: { slug: string }) {
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
  const playingRef = useRef(false);
  const editingRef = useRef(false);
  const autoAnalyze = useRef<string | null>(null);

  const settings: StudioSettings = project?.meta.settings ?? {
    silenceThreshold: 0.4,
    pad: 0.05,
    similarityThreshold: 0.7,
  };

  async function refresh() {
    const next = await getProject(slug);
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
    void refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : "Load failed"));
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
      };
      if (data.type === "confirmation_created" && data.id) {
        setHighlightAsk(data.id);
        void refresh().catch(() => undefined);
      }
      if (data.type === "confirmation_resolved" || data.type === "confirmation_cancelled") {
        setBusyAsk(null);
        void refresh().catch(() => undefined);
      }
      if (data.type === "progress") {
        setAnalysisProgress([data.message, data.ratio != null ? `${Math.round(data.ratio * 100)}%` : null].filter(Boolean).join(" "));
        void refresh().catch(() => undefined);
      }
      if (data.type === "status") {
        setAnalysisProgress(data.message ?? null);
        void refresh().catch(() => undefined);
      }
      if (data.type === "revision" || data.type === "snapshot") {
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
          else setTab("render");
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
  const warningClipIds = useMemo(
    () => new Set(warnings.map((warning) => warning.clipId).filter((id): id is string => Boolean(id))),
    [warnings],
  );

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

  async function decide(op: "select" | "reject") {
    if (!project || !selected) return;
    setConflictError(null);
    try {
      await applyOps(slug, project.revision, [{ op, clipId: selected.id }], op);
      await refresh();
    } catch (err) {
      if (err instanceof StudioConflictError) {
        setConflictError(studioCopy.conflict);
        await refresh();
        return;
      }
      setError(err instanceof Error ? err.message : "Edit failed");
    }
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
        void decide("select");
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        void decide("reject");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selectedDuration = (project?.order ?? [])
    .map((id) => clips.find((clip) => clip.id === id)?.duration ?? 0)
    .reduce((sum, value) => sum + value, 0);
  const renderBusy = render?.status === "rendering" || project?.status === "rendering";
  const analysisBusy = project?.status === "analyzing" || renderBusy;

  async function runAnalyze() {
    if (!project || analysisBusy) return;
    setError(null);
    setAnalysisProgress(studioCopy.startingAnalysis);
    try {
      await analyze(slug, project.revision);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analyze failed");
      await refresh().catch(() => undefined);
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

  return (
    <AppShell
      showBack
      backTo="/studio"
      backLabel={studioCopy.backToLibrary}
      subtitle={sourceName(project?.meta.sourcePath)}
      afterTitle={
        <span className="ml-3 truncate text-xs text-muted-foreground">{project?.meta.title ?? slug}</span>
      }
      actions={
        <>
          <StudioStepIndicator />
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Undo" onClick={() => void undo(slug).then(refresh)}>
            <Undo2 className="size-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Redo" onClick={() => void redo(slug).then(refresh)}>
            <Redo2 className="size-3.5" />
          </Button>
        </>
      }
    >
      {error ? <p className="absolute left-4 top-12 z-10 text-xs text-destructive">{error}</p> : null}
      <StudioClipsPanel
        clips={clips}
        groups={groups}
        selectedClipId={selectedClipId}
        filter={filter}
        warningClipIds={warningClipIds}
        onFilterChange={setFilter}
        onSelect={(id) => selectClip(id, false)}
        onPlay={(id) => selectClip(id, true)}
      />
      <StudioPreviewPanel
        slug={slug}
        clip={selected}
        groups={groups}
        pad={settings.pad}
        tab={tab}
        onTabChange={setTab}
        conflictError={conflictError}
        renders={renders}
        activeRenderName={activeRenderName}
        onSelectRender={(name) => {
          setActiveRenderName(name);
          setTab("render");
        }}
        onAccept={() => void decide("select")}
        onReject={() => void decide("reject")}
        onPrev={() => moveSelection(-1)}
        onNext={() => moveSelection(1)}
        autoPlayToken={autoPlayToken}
        playingRef={playingRef}
        projectStatus={project?.status}
        statusMessage={analysisProgress ?? project?.meta.statusMessage}
        onRetryAnalyze={() => void runAnalyze()}
        onEditingChange={(value) => {
          editingRef.current = value;
        }}
        onStayOnClip={(id) => setSelectedClipId(id)}
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
          setTab("render");
        }}
        onLoadSegments={() => listSegments(slug)}
        onLoadTranscript={() => getTranscript(slug)}
        clipCount={clips.length}
        hasTranscript={Boolean(project?.hasTranscript)}
        analysisBusy={Boolean(analysisBusy)}
        analysisMessage={analysisProgress ?? (project?.status === "analyzing" ? project.meta.statusMessage : null)}
        onAnalyze={() => void runAnalyze()}
        onRebuild={() => {
          if (!project) return;
          void reanalyze(slug, project.revision, { mode: "resegment", reset: true })
            .then(() => refresh())
            .catch((err: unknown) => setError(err instanceof Error ? err.message : "Rebuild failed"));
        }}
      />
    </AppShell>
  );
}
