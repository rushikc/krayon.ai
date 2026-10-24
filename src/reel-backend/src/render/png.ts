import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { CanvasElement } from "../canvas/types.js";
import { collectKeyframeTimes } from "../canvas/visibility.js";
import { sceneToSvg } from "./svgScene.js";

const require = createRequire(import.meta.url);

function geistFontFiles(): string[] {
  const files: string[] = [];
  try {
    const pkg = path.dirname(require.resolve("@fontsource-variable/geist/package.json"));
    const woff = path.join(pkg, "files", "geist-latin-wght-normal.woff2");
    if (existsSync(woff)) files.push(woff);
  } catch {
    // optional
  }
  const system = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  for (const file of system) {
    if (existsSync(file)) files.push(file);
  }
  return files;
}

const FONT_FILES = geistFontFiles();

export function renderScenePng(
  elements: CanvasElement[],
  time: number,
  width: number,
  height: number,
): Buffer {
  const svg = sceneToSvg(elements, time, width, height);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: true,
      defaultFontFamily: "Geist",
    },
  });
  return Buffer.from(resvg.render().asPng());
}

export type RenderedKeyframe = {
  index: number;
  time: number;
  png: Buffer;
};

export function renderKeyframes(
  elements: CanvasElement[],
  maxFrames: number,
  width: number,
  height: number,
): RenderedKeyframe[] {
  const times = collectKeyframeTimes(elements, maxFrames);
  return times.map((time, index) => ({
    index,
    time,
    png: renderScenePng(elements, time, width, height),
  }));
}
