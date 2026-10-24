import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Canvas } from "@/components/canvas/Canvas";
import { SchemaInspector } from "@/components/canvas/SchemaInspector";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { EditorKeyboardShortcuts } from "@/components/editor/EditorKeyboardShortcuts";
import { ExportProgressDialog } from "@/components/editor/ExportProgressDialog";
import { PlaybackBar } from "@/components/editor/PlaybackBar";
import { PreviewAudioSync } from "@/components/editor/PreviewAudioSync";
import { ReelTopBar } from "@/components/editor/ReelTopBar";
import { Timeline } from "@/components/editor/timeline/Timeline";
import { WorkspaceToolRow } from "@/components/editor/WorkspaceToolRow";
import {
  clamp,
  TIMELINE_RULER_HEIGHT,
  TRACK_ROW_HEIGHT,
} from "@/components/editor/timeline/lib/timeMath";
import { AppShell } from "@/components/layout/AppShell";
import { PanelResizeHandle } from "@/components/layout/PanelResizeHandle";
import { usePlaybackClock } from "@/hooks/usePlaybackClock";
import {
  exportReelMp4,
  sanitizeExportFilename,
} from "@/lib/export-reel";
import {
  isPreviewAudioFile,
  readAudioDuration,
  type PreviewAudioClip,
} from "@/lib/preview-audio";
import {
  getStoredShowEditor,
  getStoredShowReelPreview,
  getStoredWorkspaceSideView,
  persistShowEditor,
  persistShowReelPreview,
  persistWorkspaceSideView,
  type WorkspaceSideView,
} from "@/lib/workspace-chrome";
import { useCanvasStore } from "@/stores/canvas-store";
import { useReelChatStore } from "@/stores/reel-chat-store";
import { toast } from "@/stores/toast-store";

const MIN_INSPECTOR_HEIGHT = 120;
const MIN_TIMELINE_HEIGHT = TIMELINE_RULER_HEIGHT + TRACK_ROW_HEIGHT;

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function ReelAnimationsPage() {
  const paneRef = useRef<HTMLDivElement>(null);
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
  const [showEditor, setShowEditor] = useState(getStoredShowEditor);
  const [showReelPreview, setShowReelPreview] = useState(
    getStoredShowReelPreview,
  );
  const [inspectorHeight, setInspectorHeight] = useState(280);
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

  const onInspectorResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      const startY = event.clientY;
      const startHeight = inspectorHeight;
      const pane = paneRef.current?.clientHeight ?? 800;

      function onMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== event.pointerId) {
          return;
        }
        const maxHeight = pane - MIN_TIMELINE_HEIGHT;
        const next = startHeight + (moveEvent.clientY - startY);
        setInspectorHeight(clamp(next, MIN_INSPECTOR_HEIGHT, maxHeight));
      }

      function onUp(upEvent: PointerEvent) {
        if (upEvent.pointerId !== event.pointerId) {
          return;
        }
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        if (handle.hasPointerCapture(upEvent.pointerId)) {
          handle.releasePointerCapture(upEvent.pointerId);
        }
      }

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [inspectorHeight],
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

  const showInspector = sideView === "timeline" && showEditor;

  return (
    <AppShell hideHeader>
      <EditorKeyboardShortcuts />
      <PreviewAudioSync clip={previewAudio} muted={previewAudioMuted} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ReelTopBar
          projectName={projectName}
          onProjectNameChange={setProjectName}
          exporting={exporting}
          onExport={() => void onExport()}
        />
        <div className="flex min-h-0 min-w-0 flex-1">
          <div className="flex h-full min-h-0 w-auto shrink-0 flex-col items-stretch border-r border-border bg-card">
            <div className="flex min-h-0 flex-1 items-stretch p-2">
              <Canvas
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
              showEditor={showEditor}
              onToggleEditor={() =>
                setShowEditor((value) => {
                  const next = !value;
                  persistShowEditor(next);
                  return next;
                })
              }
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
              <div ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
                {showInspector ? (
                  <>
                    <div
                      className="min-h-0 shrink-0 overflow-hidden p-2"
                      style={{ height: inspectorHeight }}
                    >
                      <SchemaInspector />
                    </div>
                    <PanelResizeHandle
                      orientation="horizontal"
                      placement="bar"
                      label="Resize inspector"
                      onPointerDown={onInspectorResizeStart}
                    />
                  </>
                ) : null}
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
                    previewAudio={previewAudio}
                    onRemoveAudio={clearPreviewAudio}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <ExportProgressDialog
        open={exporting}
        progress={exportProgress}
        startedAt={exportStartedAt}
        onCancel={() => exportAbortRef.current?.abort()}
      />
    </AppShell>
  );
}
