import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHROME_PATH, loadConfig, repoRoot } from "../../src/config.js";
import { runBuild } from "../../src/diagram/pipeline.js";
import { silentLogger } from "../helpers.js";
import { CARD_INNER_WIDTH, EXPORT_PADDING, EXPORT_SCALE } from "../../src/diagram/tokens.js";
import { isWhite, pngCornerRgba } from "./pngPixels.js";

const chromeMissing = !existsSync(DEFAULT_CHROME_PATH);
const maxWidth = CARD_INNER_WIDTH * EXPORT_SCALE + EXPORT_PADDING * EXPORT_SCALE * 2;
const renderTitle = chromeMissing
  ? `skipped: Chrome not found at ${DEFAULT_CHROME_PATH}`
  : "writes white-padded PNGs within the card width budget";

describe("diagram chrome render", () => {
  it.skipIf(chromeMissing)(
    renderTitle,
    async () => {
      const config = loadConfig();
      const result = await runBuild(config, "_examples/uber-ttl", silentLogger);
      expect(result.envError).toBe(false);
      const pngRel = result.status?.cards[0]?.steps[0]?.png;
      expect(pngRel).toBeTruthy();
      const pngPath = path.join(repoRoot, pngRel!);
      const buf = readFileSync(pngPath);
      const corners = pngCornerRgba(buf);
      expect(corners.width).toBeLessThanOrEqual(maxWidth);
      expect(isWhite(corners.tl)).toBe(true);
      expect(isWhite(corners.tr)).toBe(true);
      expect(isWhite(corners.bl)).toBe(true);
      expect(isWhite(corners.br)).toBe(true);
    },
    60_000,
  );
});
