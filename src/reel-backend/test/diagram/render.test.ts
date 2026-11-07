import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHROME_PATH, loadConfig, repoRoot } from "../../src/config.js";
import { runBuild } from "../../src/diagram/pipeline.js";
import { silentLogger } from "../helpers.js";
import { CARD_INNER_WIDTH, EXPORT_PADDING, EXPORT_SCALE } from "../../src/diagram/tokens.js";
import { inkTouchesRightOrBottom, isWhite, pngCornerRgba } from "./pngPixels.js";

const chromeMissing = !existsSync(DEFAULT_CHROME_PATH);
const maxWidth = CARD_INNER_WIDTH * EXPORT_SCALE + EXPORT_PADDING * EXPORT_SCALE * 2;
const renderTitle = chromeMissing
  ? `skipped: Chrome not found at ${DEFAULT_CHROME_PATH}`
  : "writes 2x white-padded PNGs, not a 1x crop";

function expectSize(buf: Buffer, width: number, height: number, tol = 8) {
  const corners = pngCornerRgba(buf);
  expect(corners.width).toBeGreaterThanOrEqual(width - tol);
  expect(corners.width).toBeLessThanOrEqual(width + tol);
  expect(corners.height).toBeGreaterThanOrEqual(height - tol);
  expect(corners.height).toBeLessThanOrEqual(height + tol);
  expect(corners.width).toBeLessThanOrEqual(maxWidth);
  expect(isWhite(corners.tl)).toBe(true);
  expect(isWhite(corners.tr)).toBe(true);
  expect(isWhite(corners.bl)).toBe(true);
  expect(isWhite(corners.br)).toBe(true);
  expect(inkTouchesRightOrBottom(buf)).toBe(false);
}

describe("diagram chrome render", () => {
  it.skipIf(chromeMissing)(
    renderTitle,
    async () => {
      const config = loadConfig();
      const uber = await runBuild(config, "_examples/uber-ttl", silentLogger);
      expect(uber.envError).toBe(false);
      const airbnb = await runBuild(config, "_examples/airbnb-flow", silentLogger);
      expect(airbnb.envError).toBe(false);

      const uberStep01 = path.join(repoRoot, "diagrams/_examples/uber-ttl/review/redis-dynamo/step-01.png");
      const airbnbStep04 = path.join(
        repoRoot,
        "diagrams/_examples/airbnb-flow/review/client-auth-ui/step-04.png",
      );
      expectSize(readFileSync(uberStep01), 1270, 1308);
      expectSize(readFileSync(airbnbStep04), 1830, 1558);
    },
    90_000,
  );
});
