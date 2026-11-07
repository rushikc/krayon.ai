import { Download } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ChatPanel } from "@/components/chat/ChatPanel";
import { EditorKeyboardShortcuts } from "@/components/editor/EditorKeyboardShortcuts";
import { ElementEditDialog } from "@/components/editor/ElementEditDialog";
import { ExportProgressDialog } from "@/components/editor/ExportProgressDialog";
import { PlaybackBar } from "@/components/editor/PlaybackBar";
import { PreviewAudioSync } from "@/components/editor/PreviewAudioSync";
import { ReelTopBar } from "@/components/editor/ReelTopBar";
import { Timeline } from "@/components/editor/timeline/Timeline";
import { WorkspaceToolRow } from "@/components/editor/WorkspaceToolRow";
import { AppShell } from "@/components/layout/AppShell";
import { RushkStage } from "@/components/reel/RushkStage";
import { Button } from "@/components/ui/button";
import { useFitReel } from "@/hooks/useFitReel";
import { usePlaybackClock } from "@/hooks/usePlaybackClock";
import {
  getDiagramMeta,
  listDiagrams,
  type DiagramListItem,
} from "@/lib/api/reel-client";
import {
  diagramBuildHint,
  diagramStepsToElements,
  visibleDiagramStep,
  type DiagramMeta,
} from "@/lib/diagram-timeline";
import { exportReelMp4, sanitizeExportFilename } from "@/lib/export-reel";
import { reelColumnWidth } from "@/lib/fit-reel";
import {
  isPreviewAudioFile,
  readAudioDuration,
  type PreviewAudioClip,
} from "@/lib/preview-audio";
import { studioCopy } from "@/lib/studio-copy";
import {
  getStoredShowReelPreview,
  getStoredWorkspaceSideView,
  persistShowReelPreview,
  persistWorkspaceSideView,
  type WorkspaceSideView,
} from "@/lib/workspace-chrome";
import { StudioStepIndicator } from "@/pages/studio/StudioStepIndicator";
import { useCanvasStore } from "@/stores/canvas-store";
import { useReelChatStore } from "@/stores/reel-chat-store";
import { toast } from "@/stores/toast-store";
import { isDiagramNode } from "@/types/canvas";

export type ReelWorkspaceAudio =
  | { kind: "none" }
  | { kind: "upload" }
  | { kind: "url"; url: string; durationHint?: number };

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function ReelWorkspace({
  audio,
  diagramReelId,
  onDiagramReelIdChange,
  studioChrome,
}: {
  audio: ReelWorkspaceAudio;
  diagramReelId: string | null;
  onDiagramReelIdChange?: (reelId: string | null) => void;
  studioChrome?: { slug: string };
}) {
  const navigate = useNavigate();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const reelSize = useFitReel(workspaceRef, stageRef);
  const elements = useCanvasStore((state) => state.elements);
  const duration = useCanvasStore((state) => state.duration);
  const selectedId = useCanvasStore((state) => state.selectedId);
  const selectElement = useCanvasStore((state) => state.selectElement);
  const setElements = useCanvasStore((state) => state.setElements);
  const currentTime = useCanvasStore((state) => state.currentTime);
  const setCurrentTime = useCanvasStore((state) => state.setCurrentTime);
  const trackCount = useCanvasStore((state) => state.trackCount);
  const addTrack = useCanvasStore((state) => state.addTrack);
  const deleteTrack = useCanvasStore((state) => state.deleteTrack);
  const renderTheme = useCanvasStore((state) => state.renderTheme);
  const setRenderTheme = useCanvasStore((state) => state.setRenderTheme);
  const setPreviewAudioDuration = useCanvasStore((state) => state.setPreviewAudioDuration);

  usePlaybackClock();
  const hydrateChat = useReelChatStore((state) => state.hydrate);
  const setDiagramLocked = useReelChatStore((state) => state.setDiagramLocked);

  useEffect(() => {
    void hydrateChat();
  }, [hydrateChat]);

  useEffect(() => {
    setDiagramLocked(Boolean(diagramReelId));
    return () => setDiagramLocked(false);
  }, [diagramReelId, setDiagramLocked]);

  useEffect(() => {
    return () => {
      useCanvasStore.getState().reset();
    };
  }, []);

  const [sideView, setSideView] = useState<WorkspaceSideView>(getStoredWorkspaceSideView);
  const [showReelPreview, setShowReelPreview] = useState(getStoredShowReelPreview);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStartedAt, setExportStartedAt] = useState<number | null>(null);
  const [projectName, setProjectName] = useState("krayon-reel");
  const exportAbortRef = useRef<AbortController | null>(null);
  const [previewAudio, setPreviewAudio] = useState<PreviewAudioClip | null>(null);
  const [previewAudioMuted, setPreviewAudioMuted] = useState(false);
  const previewAudioUrlRef = useRef<string | null>(null);
  const [picker, setPicker] = useState<DiagramListItem[]>([]);
  const [meta, setMeta] = useState<DiagramMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const clearPreviewAudio = useCallback(() => {
    if (previewAudioUrlRef.current) {
      URL.revokeObjectURL(previewAudioUrlRef.current);
      previewAudioUrlRef.current = null;
    }
    setPreviewAudio(null);
    setPreviewAudioDuration(null);
  }, [setPreviewAudioDuration]);

  useEffect(() => {
    return () => {
      if (previewAudioUrlRef.current) {
        URL.revokeObjectURL(previewAudioUrlRef.current);
      }
      useCanvasStore.getState().setPreviewAudioDuration(null);
    };
  }, []);

  useEffect(() => {
    void listDiagrams()
      .then(setPicker)
      .catch(() => setPicker([]));
  }, []);

  useEffect(() => {
    if (audio.kind !== "url") {
      return;
    }
    let cancelled = false;
    const url = audio.url;
    void (async () => {
      try {
        const durationHint =
          audio.durationHint ?? (await readAudioDuration(url));
        if (cancelled) {
          return;
        }
        setPreviewAudio({
          objectUrl: url,
          name: "cut-audio.wav",
          duration: durationHint,
        });
        setPreviewAudioDuration(durationHint);
      } catch (error) {
        if (!cancelled) {
          toast(error instanceof Error ? error.message : "Could not load cut audio");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audio, setPreviewAudioDuration]);

  useEffect(() => {
    if (!diagramReelId) {
      setMeta(null);
      setLoadError(null);
      setElements([]);
      useCanvasStore.setState({ trackCount: 1 });
      return;
    }
    let cancelled = false;
    void getDiagramMeta(diagramReelId)
      .then((next) => {
        if (cancelled) {
          return;
        }
        const mapped: DiagramMeta = {
          reelArg: next.reelArg,
          title: next.title,
          cards: next.cards,
          status: next.status,
        };
        setMeta(mapped);
        setLoadError(null);
        const audioDuration =
          useCanvasStore.getState().previewAudioDuration;
        const nodes = diagramStepsToElements(mapped, audioDuration);
        setElements(nodes);
        const tracks = Math.max(1, mapped.cards.length);
        useCanvasStore.setState({ trackCount: tracks });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setMeta(null);
        setLoadError(error instanceof Error ? error.message : "Could not load reel");
        setElements([]);
      });
    return () => {
      cancelled = true;
    };
  }, [diagramReelId, setElements]);

  const onUploadAudio = useCallback(
    async (file: File) => {
      if (!isPreviewAudioFile(file)) {
        toast("Choose a WAV or MP3 file");
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      try {
        const audioDuration = await readAudioDuration(objectUrl);
        if (previewAudioUrlRef.current) {
          URL.revokeObjectURL(previewAudioUrlRef.current);
        }
        previewAudioUrlRef.current = objectUrl;
        setPreviewAudio({
          objectUrl,
          name: file.name,
          duration: audioDuration,
        });
        setPreviewAudioDuration(audioDuration);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        toast(error instanceof Error ? error.message : "Could not load audio");
      }
    },
    [setPreviewAudioDuration],
  );

  const onExport = useCallback(async () => {
    if (exporting) {
      return;
    }
    const { flushSync } = await import("react-dom");
    const store = useCanvasStore.getState();
    store.pause();
    const restoreTime = store.currentTime;
    const filename = sanitizeExportFilename(projectName);
    const controller = new AbortController();
    exportAbortRef.current = controller;
    flushSync(() => {
      setExporting(true);
      setExportProgress(0);
      setExportStartedAt(Date.now());
    });
    try {
      const captureElement =
        document.querySelector<HTMLElement>("[data-reel-stage]") ??
        document.querySelector<HTMLElement>("[data-render-theme]");
      if (!captureElement) {
        throw new Error("Export canvas is not ready.");
      }
      await exportReelMp4({
        captureElement,
        duration: store.duration,
        setCurrentTime: useCanvasStore.getState().setCurrentTime,
        onProgress: setExportProgress,
        filename,
        signal: controller.signal,
      });
      toast(`Exported ${filename}`);
    } catch (error) {
      if (isAbortError(error)) {
        toast("Export cancelled");
      } else {
        toast(error instanceof Error ? error.message : "Export failed");
      }
    } finally {
      exportAbortRef.current = null;
      useCanvasStore.getState().setCurrentTime(restoreTime);
      setExporting(false);
      setExportProgress(0);
      setExportStartedAt(null);
    }
  }, [exporting, projectName]);

  const changeSideView = (view: WorkspaceSideView) => {
    persistWorkspaceSideView(view);
    setSideView(view);
  };

  const diagramNodes = elements.filter(isDiagramNode);
  const visible = visibleDiagramStep(diagramNodes, currentTime);
  const built = Boolean(meta?.status?.ok);
  const unbuilt = Boolean(diagramReelId) && !built;
  const issues = [
    ...(loadError ? [loadError] : []),
    ...(meta?.status?.issues.map((issue) => issue.message) ?? []),
    ...(unbuilt && diagramReelId ? [diagramBuildHint(diagramReelId)] : []),
  ];

  const stage = (
    <RushkStage
      width={reelSize.width}
      height={reelSize.height}
      title={meta?.title ?? ""}
      caption={visible?.caption ?? ""}
      pngUrl={built ? (visible?.pngUrl ?? null) : null}
      reelArg={diagramReelId}
      issues={issues.filter((item, index, list) => list.indexOf(item) === index)}
      unbuilt={unbuilt}
      picker={picker}
      onPick={(id) => onDiagramReelIdChange?.(id)}
    />
  );

  const body = (
    <>
      <EditorKeyboardShortcuts
        onToggleSideView={() =>
          changeSideView(sideView === "timeline" ? "chat" : "timeline")
        }
      />
      <PreviewAudioSync clip={previewAudio} muted={previewAudioMuted} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {studioChrome ? null : (
          <ReelTopBar
            projectName={projectName}
            onProjectNameChange={setProjectName}
            exporting={exporting}
            onExport={() => void onExport()}
          />
        )}
        <div
          ref={workspaceRef}
          data-workspace-row
          className="flex min-h-0 min-w-0 flex-1"
        >
          <div
            className="flex h-full min-h-0 shrink-0 flex-col items-stretch border-r border-border bg-card"
            style={{ width: reelColumnWidth(reelSize.width) }}
          >
            <div
              ref={stageRef}
              className="flex min-h-0 flex-1 items-center justify-center p-2"
            >
              {stage}
            </div>
            <PlaybackBar />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <WorkspaceToolRow
              sideView={sideView}
              onSideViewChange={changeSideView}
              showReelPreview={showReelPreview}
              onToggleReelPreview={() =>
                setShowReelPreview((value) => {
                  const next = !value;
                  persistShowReelPreview(next);
                  return next;
                })
              }
              renderTheme={renderTheme}
              onRenderThemeChange={setRenderTheme}
              previewAudioMuted={previewAudioMuted}
              onMutedChange={setPreviewAudioMuted}
              onUploadAudio={(file) => void onUploadAudio(file)}
              allowAudioUpload={audio.kind === "upload"}
            />
            {sideView === "chat" ? (
              <div className="min-h-0 flex-1">
                <ChatPanel
                  onApplied={() => changeSideView("timeline")}
                  diagramMode={Boolean(diagramReelId)}
                />
              </div>
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="min-h-0 min-w-0 flex-1">
                  <Timeline
                    elements={elements}
                    duration={duration}
                    currentTime={currentTime}
                    trackCount={trackCount}
                    selectedId={selectedId}
                    onSelect={selectElement}
                    onChange={setElements}
                    onSeek={setCurrentTime}
                    onAddTrack={addTrack}
                    onDeleteTrack={deleteTrack}
                    onEditElement={setEditingElementId}
                    previewAudio={previewAudio}
                    onRemoveAudio={audio.kind === "upload" ? clearPreviewAudio : undefined}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <ElementEditDialog
        elementId={editingElementId}
        onClose={() => setEditingElementId(null)}
      />
      <ExportProgressDialog
        open={exporting}
        progress={exportProgress}
        startedAt={exportStartedAt}
        onCancel={() => exportAbortRef.current?.abort()}
      />
    </>
  );

  if (studioChrome) {
    return (
      <AppShell
        showBack
        backTo="/studio"
        backLabel={studioCopy.backToLibrary}
        title={studioChrome.slug}
        actions={
          <div className="flex items-center gap-2">
            <StudioStepIndicator
              activeId="video"
              videoEnabled
              onAudioClick={() => navigate(`/studio/${studioChrome.slug}`)}
              onVideoClick={() => navigate(`/studio/${studioChrome.slug}/video`)}
            />
            <Button
              type="button"
              disabled={exporting}
              onClick={() => void onExport()}
              aria-label="Export MP4"
            >
              <Download />
              Export
            </Button>
          </div>
        }
      >
        {body}
      </AppShell>
    );
  }

  return <AppShell hideHeader>{body}</AppShell>;
}
