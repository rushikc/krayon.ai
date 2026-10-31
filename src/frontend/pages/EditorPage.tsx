import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { ClipsSidebar } from "@/components/layout/ClipsSidebar";
import { ControlsPanel } from "@/components/layout/ControlsPanel";
import { TranscriptPanel } from "@/components/layout/TranscriptPanel";
import { ClipAudioPlayer } from "@/components/player/ClipAudioPlayer";
import { PipelineStepper } from "@/components/player/PipelineStepper";
import { useMediaStore } from "@/stores/media-store";
import { useSilenceStore } from "@/stores/silence-store";

export function EditorPage() {
  const { mediaId } = useParams<{ mediaId: string }>();
  const navigate = useNavigate();

  const { files, setSelected, clearSelection, loadEditorState } = useMediaStore();
  const { phase, transcriptOpen } = useSilenceStore();
  const selectedFile = files.find((f) => f.id === mediaId) ?? null;
  const showStepper = phase === "running";
  const hydratedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mediaId) return;
    if (files.length === 0) return;
    if (!files.some((f) => f.id === mediaId)) {
      navigate("/audio", { replace: true });
      return;
    }
    if (hydratedIdRef.current === mediaId) return;
    hydratedIdRef.current = mediaId;
    setSelected(mediaId);
    clearSelection();
    void loadEditorState(mediaId);
  }, [mediaId, files, setSelected, clearSelection, loadEditorState, navigate]);

  return (
    <AppShell
      showBack
      backTo="/audio"
      backLabel="Back to library"
      title={selectedFile?.name ?? "editor"}
    >
      <ClipsSidebar />
      {showStepper ? <PipelineStepper /> : <ClipAudioPlayer />}
      {transcriptOpen ? <TranscriptPanel /> : null}
      <ControlsPanel />
    </AppShell>
  );
}
