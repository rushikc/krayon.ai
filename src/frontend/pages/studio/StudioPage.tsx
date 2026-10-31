import { useParams } from "react-router-dom";

import { StudioLanding } from "@/pages/studio/StudioLanding";
import { StudioWorkspace } from "@/pages/studio/StudioWorkspace";

export function StudioPage() {
  const { slug } = useParams();
  if (!slug) return <StudioLanding />;
  return <StudioWorkspace slug={slug} />;
}
