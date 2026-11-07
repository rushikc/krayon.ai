import { readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../config.js";

export type RushkColors = {
  background: string;
  card: string;
  badgeBlue: string;
  badgeText: string;
  strokeBlue: string;
  annotationRed: string;
  success: string;
  ink: string;
};

let cached: RushkColors | undefined;

export function rushkColors(): RushkColors {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(path.join(repoRoot, "docs/rushk/tokens.json"), "utf8")) as {
    color: RushkColors;
  };
  cached = raw.color;
  return cached;
}

export const CARD_INNER_WIDTH = 880;
export const EXPORT_PADDING = 24;
export const EXPORT_SCALE = 2;
export const BASE_FONT_SIZE = 20;
export const NODE_MIN_WIDTH = 220;
export const NODE_MIN_HEIGHT = 90;
export const NODE_PAD = 24;
export const CHAR_WIDTH_RATIO = 0.85;
export const LINE_HEIGHT_RATIO = 1.35;
export const DIAMOND_SCALE = 1.6;
export const ATTACH_GAP = 16;
export const DENSITY_WARN = 6;
export const DENSITY_ERROR = 10;
export const WORD_SNAP_S = 0.8;
export const NODE_LABEL_MAX = 28;
export const BADGE_TEXT_MAX = 40;
export const ANNOTATION_MAX = 24;
export const CAPTION_MAX = 60;
