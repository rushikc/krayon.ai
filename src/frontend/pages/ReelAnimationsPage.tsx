import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ReelWorkspace } from "@/components/reel/ReelWorkspace";
import {
  getStoredDiagramReelId,
  persistDiagramReelId,
} from "@/lib/workspace-chrome";

export function ReelAnimationsPage() {
  const navigate = useNavigate();
  const splat = useParams()["*"];
  const fromUrl = splat?.replace(/^\/+|\/+$/g, "") || null;
  const diagramReelId = fromUrl ?? getStoredDiagramReelId();

  useEffect(() => {
    if (!fromUrl) {
      const stored = getStoredDiagramReelId();
      if (stored) {
        navigate(`/reel-animations/${stored}`, { replace: true });
      }
    }
  }, [fromUrl, navigate]);

  return (
    <ReelWorkspace
      audio={{ kind: "upload" }}
      diagramReelId={diagramReelId}
      onDiagramReelIdChange={(reelId) => {
        persistDiagramReelId(reelId);
        if (reelId) {
          navigate(`/reel-animations/${reelId}`);
        } else {
          navigate("/reel-animations");
        }
      }}
    />
  );
}
