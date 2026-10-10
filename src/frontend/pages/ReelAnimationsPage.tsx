import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Canvas } from "@/components/canvas/Canvas";
import { SchemaInspector } from "@/components/canvas/SchemaInspector";
import { EditorKeyboardShortcuts } from "@/components/editor/EditorKeyboardShortcuts";
import { ExportProgressDialog } from "@/components/editor/ExportProgressDialog";
import { PlaybackBar } from "@/components/editor/PlaybackBar";
import { PreviewAudioSync } from "@/components/editor/PreviewAudioSync";
import { Timeline } from "@/components/editor/timeline/Timeline";
import { WorkspaceToolbar } from "@/components/editor/WorkspaceToolbar";
import {
  clamp,
  DEFAULT_TIMELINE_HEIGHT,
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
  getStoredShowTimeline,
  persistShowEditor,
  persistShowReelPreview,
  persistShowTimeline,
} from "@/lib/workspace-chrome";
import { useCanvasStore } from "@/stores/canvas-store";
import { toast } from "@/stores/toast-store";

const MIN_TIMELINE_HEIGHT = TIMELINE_RULER_HEIGHT + TRACK_ROW_HEIGHT;

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function ReelAnimationsPage() {
  const middleRef = useRef<HTMLDivElement>(null);
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

  const [showTimeline, setShowTimeline] = useState(getStoredShowTimeline);
  const [showEditor, setShowEditor] = useState(getStoredShowEditor);
  const [showReelPreview, setShowReelPreview] = useState(
    getStoredShowReelPreview,
  );
  const [timelineHeight, setTimelineHeight] = useState(DEFAULT_TIMELINE_HEIGHT);
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

  const onTimelineResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      const startY = event.clientY;
      const startHeight = timelineHeight;
      const middle = middleRef.current?.clientHeight ?? 800;

      function onMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== event.pointerId) {
          return;
        }
        const maxHeight = middle * 0.7;
        const next = startHeight + (startY - moveEvent.clientY);
        setTimelineHeight(clamp(next, MIN_TIMELINE_HEIGHT, maxHeight));
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
    [timelineHeight],
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

  return (
    <AppShell hideHeader>
      <EditorKeyboardShortcuts />
      <PreviewAudioSync clip={previewAudio} muted={previewAudioMuted} />
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex h-full min-h-0 shrink-0 items-stretch p-2">
          <Canvas
            showReelPreview={showReelPreview}
            exporting={exporting}
          />
        </div>

        <div
          ref={middleRef}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <WorkspaceToolbar
            showTimeline={showTimeline}
            showEditor={showEditor}
            showReelPreview={showReelPreview}
            onToggleTimeline={() =>
              setShowTimeline((value) => {
                const next = !value;
                persistShowTimeline(next);
                return next;
              })
            }
            onToggleEditor={() =>
              setShowEditor((value) => {
                const next = !value;
                persistShowEditor(next);
                return next;
              })
            }
            onToggleReelPreview={() =>
              setShowReelPreview((value) => {
                const next = !value;
                persistShowReelPreview(next);
                return next;
              })
            }
            renderTheme={renderTheme}
            onRenderThemeChange={setRenderTheme}
            exporting={exporting}
            onExport={() => void onExport()}
            onUploadAudio={(file) => void onUploadAudio(file)}
          />

          <div className="flex min-h-0 min-w-0 flex-1 p-2">
            {showEditor ? (
              <SchemaInspector
                projectName={projectName}
                onProjectNameChange={setProjectName}
              />
            ) : null}
          </div>

          <PlaybackBar
            muted={previewAudioMuted}
            onMutedChange={setPreviewAudioMuted}
          />

          {showTimeline ? (
            <div className="flex w-full shrink-0 flex-col">
              <PanelResizeHandle
                orientation="horizontal"
                placement="bar"
                label="Resize timeline"
                onPointerDown={onTimelineResizeStart}
              />
              <div className="min-h-0 w-full" style={{ height: timelineHeight }}>
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
          ) : null}
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
