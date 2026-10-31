import { describe, expect, it } from "vitest";

import {
  fitReelFrame,
  MAX_COLUMN_FRACTION,
  MIN_REEL_WIDTH,
  reelColumnWidth,
  STAGE_PADDING_PX,
} from "@/lib/fit-reel";

const RATIO = 16 / 9;

function expectNineSixteen(size: { width: number; height: number }) {
  expect(size.width).toBeGreaterThan(0);
  expect(size.height / size.width).toBeCloseTo(RATIO, 8);
}

describe("fitReelFrame", () => {
  it("fills height when the column cap is not binding", () => {
    const size = fitReelFrame(800, 800, 1440);
    expectNineSixteen(size);
    expect(size.width).toBeCloseTo(800 * (9 / 16));
    expect(size.width).toBeGreaterThanOrEqual(MIN_REEL_WIDTH);
    expect(size.width).toBeLessThanOrEqual(1440 * MAX_COLUMN_FRACTION);
  });

  it("caps width at 45% of the viewport minus stage padding", () => {
    const viewportW = 1000;
    const size = fitReelFrame(2000, 2000, viewportW);
    expectNineSixteen(size);
    expect(size.width).toBeCloseTo(
      viewportW * MAX_COLUMN_FRACTION - STAGE_PADDING_PX,
    );
  });

  it("scales below the min width on a short window", () => {
    const size = fitReelFrame(400, 200, 1024);
    expectNineSixteen(size);
    expect(size.width).toBeLessThan(MIN_REEL_WIDTH);
    expect(size.width).toBeCloseTo(200 * (9 / 16));
  });

  it("uses the min width when height and column cap allow", () => {
    const size = fitReelFrame(300, 500, 1440);
    expectNineSixteen(size);
    expect(size.width).toBeGreaterThanOrEqual(MIN_REEL_WIDTH);
    expect(size.width).toBeLessThanOrEqual(300);
  });

  it("never exceeds available width", () => {
    const size = fitReelFrame(180, 900, 400);
    expectNineSixteen(size);
    expect(size.width).toBeLessThanOrEqual(180);
  });

  it("derives the left column from the fitted reel plus padding", () => {
    const size = fitReelFrame(400, 800, 1440);
    expect(reelColumnWidth(size.width)).toBe(size.width + STAGE_PADDING_PX);
  });
});
