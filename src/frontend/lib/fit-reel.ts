export const REEL_ASPECT_WIDTH = 9;
export const REEL_ASPECT_HEIGHT = 16;
export const MIN_REEL_WIDTH = 220;
export const MAX_COLUMN_FRACTION = 0.45;
/** Tailwind `p-2` on both axes of the canvas stage. */
export const STAGE_PADDING_PX = 16;

export interface ReelFrameSize {
  width: number;
  height: number;
}

/**
 * Fit a 9:16 reel into the stage. `viewportW` caps the left column at 45%.
 * Width is at least {@link MIN_REEL_WIDTH} when height and the column cap allow;
 * otherwise the frame scales down and stays exactly 9:16.
 */
export function fitReelFrame(
  availW: number,
  availH: number,
  viewportW: number,
): ReelFrameSize {
  const innerAvailW = Math.max(0, availW);
  const innerAvailH = Math.max(0, availH);
  const maxFromColumn = Math.max(
    0,
    viewportW * MAX_COLUMN_FRACTION - STAGE_PADDING_PX,
  );
  const maxFromHeight = innerAvailH * (REEL_ASPECT_WIDTH / REEL_ASPECT_HEIGHT);
  let width = Math.min(innerAvailW, maxFromHeight, maxFromColumn);

  const minFits =
    MIN_REEL_WIDTH <= innerAvailW &&
    MIN_REEL_WIDTH <= maxFromColumn &&
    MIN_REEL_WIDTH * (REEL_ASPECT_HEIGHT / REEL_ASPECT_WIDTH) <= innerAvailH;
  if (width < MIN_REEL_WIDTH && minFits) {
    width = MIN_REEL_WIDTH;
  }

  if (!Number.isFinite(width) || width <= 0) {
    return { width: 0, height: 0 };
  }

  return {
    width,
    height: width * (REEL_ASPECT_HEIGHT / REEL_ASPECT_WIDTH),
  };
}

export function reelColumnWidth(frameWidth: number): number {
  return frameWidth + STAGE_PADDING_PX;
}
