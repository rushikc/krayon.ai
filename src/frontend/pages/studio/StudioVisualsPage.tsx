import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ReelWorkspace } from "@/components/reel/ReelWorkspace";
import {
  cutAudioUrl,
  getProject,
  updateCanvasDraft,
  type StudioProject,
} from "@/lib/api/studio-client";
import { diagramReelIdFromDraft } from "@/lib/diagram-timeline";

export function StudioVisualsPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<StudioProject | null>(null);
  const [reelId, setReelId] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      return;
    }
    void getProject(slug)
      .then((next) => {
        const ready = next.status === "ready" && next.order.length > 0;
        if (!ready) {
          navigate(`/studio/${slug}`, { replace: true });
          return;
        }
        setProject(next);
        setReelId(diagramReelIdFromDraft(next.canvasDraft));
      })
      .catch(() => navigate("/studio", { replace: true }));
  }, [navigate, slug]);

  const selectedDuration = useMemo(() => {
    if (!project) {
      return undefined;
    }
    return project.order.reduce((sum, id) => {
      const clip = project.clips.find((item) => item.id === id);
      return sum + (clip?.duration ?? 0);
    }, 0);
  }, [project]);

  if (!slug || !project) {
    return null;
  }

  return (
    <ReelWorkspace
      studioChrome={{ slug }}
      audio={{
        kind: "url",
        url: cutAudioUrl(slug, project.revision),
        durationHint: selectedDuration,
      }}
      diagramReelId={reelId}
      onDiagramReelIdChange={(next) => {
        setReelId(next);
        void updateCanvasDraft(slug, next);
      }}
    />
  );
}
