import { useLayoutEffect, useState, type RefObject } from "react";

import {
  fitReelFrame,
  MIN_REEL_WIDTH,
  STAGE_PADDING_PX,
  type ReelFrameSize,
} from "@/lib/fit-reel";

const FALLBACK: ReelFrameSize = {
  width: MIN_REEL_WIDTH,
  height: MIN_REEL_WIDTH * (16 / 9),
};

function measure(
  workspace: HTMLElement | null,
  stage: HTMLElement | null,
): ReelFrameSize | null {
  if (!workspace || !stage) {
    return null;
  }
  const viewportW = workspace.clientWidth;
  const availH = stage.clientHeight - STAGE_PADDING_PX;
  const availW = viewportW;
  if (viewportW <= 0 || stage.clientHeight <= 0) {
    return null;
  }
  return fitReelFrame(availW, availH, viewportW);
}

export function useFitReel(
  workspaceRef: RefObject<HTMLElement | null>,
  stageRef: RefObject<HTMLElement | null>,
): ReelFrameSize {
  const [size, setSize] = useState<ReelFrameSize>(FALLBACK);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    const stage = stageRef.current;
    if (!workspace || !stage) {
      return;
    }

    const update = () => {
      const next = measure(workspace, stage);
      if (next && next.width > 0) {
        setSize(next);
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(workspace);
    observer.observe(stage);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [stageRef, workspaceRef]);

  return size;
}
