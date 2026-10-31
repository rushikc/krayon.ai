import { useCallback, useEffect, useRef, useState } from "react";

import { Canvas } from "@/components/canvas/Canvas";
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
import { useFitReel } from "@/hooks/useFitReel";
import { usePlaybackClock } from "@/hooks/usePlaybackClock";
import {
  exportReelMp4,
  sanitizeExportFilename,
} from "@/lib/export-reel";
import { reelColumnWidth } from "@/lib/fit-reel";
import {
  isPreviewAudioFile,
  readAudioDuration,
  type PreviewAudioClip,
} from "@/lib/preview-audio";
import {
  getStoredShowReelPreview,
  getStoredWorkspaceSideView,
  persistShowReelPreview,
  persistWorkspaceSideView,
  type WorkspaceSideView,
} from "@/lib/workspace-chrome";
import { useCanvasStore } from "@/stores/canvas-store";
import { useReelChatStore } from "@/stores/reel-chat-store";
import { toast } from "@/stores/toast-store";

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function ReelAnimationsPage() {
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
  const setPreviewAudioDuration = useCanvasStore(
    (state) => state.setPreviewAudioDuration,
  );

  usePlaybackClock();
  const hydrateChat = useReelChatStore((state) => state.hydrate);

  useEffect(() => {
    void hydrateChat();
  }, [hydrateChat]);

  const [sideView, setSideView] = useState<WorkspaceSideView>(
    getStoredWorkspaceSideView,
  );
  const [showReelPreview, setShowReelPreview] = useState(
    getStoredShowReelPreview,
  );
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStartedAt, setExportStartedAt] = useState<number | null>(null);
  const [projectName, setProjectName] = useState("krayon-reel");
  const exportAbortRef = useRef<AbortController | null>(null);
  const [previewAudio, setPreviewAudio] = useState<PreviewAudioClip | null>(
    null,
  );
  const [previewAudioMuted, setPreviewAudioMuted] = useState(false);
  const previewAudioUrlRef = useRef<string | null>(null);

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
      const captureElement = document.querySelector<HTMLElement>(
        "[data-render-theme]",
      );
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

  return (
    <AppShell hideHeader>
      <EditorKeyboardShortcuts
        onToggleSideView={() =>
          changeSideView(sideView === "timeline" ? "chat" : "timeline")
        }
      />
      <PreviewAudioSync clip={previewAudio} muted={previewAudioMuted} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ReelTopBar
          projectName={projectName}
          onProjectNameChange={setProjectName}
          exporting={exporting}
          onExport={() => void onExport()}
        />
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
              data-reel-stage
              className="flex min-h-0 flex-1 items-center justify-center p-2"
            >
              <Canvas
                width={reelSize.width}
                height={reelSize.height}
                showReelPreview={showReelPreview}
                exporting={exporting}
              />
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
            />

            {sideView === "chat" ? (
              <div className="min-h-0 flex-1">
                <ChatPanel onApplied={() => changeSideView("timeline")} />
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
                    onRemoveAudio={clearPreviewAudio}
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
    </AppShell>
  );
}
