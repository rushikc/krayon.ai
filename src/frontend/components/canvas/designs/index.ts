import type { RenderTheme } from "@/lib/render-theme";

import { brightDesign } from "./bright";
import { calidrawDarkDesign } from "./calidraw-dark";
import { calidrawLightDesign } from "./calidraw-light";
import { canaryDesign } from "./canary";
import { darkDesign } from "./dark";
import type { CanvasDesign } from "./types";

const DESIGNS: Record<RenderTheme, CanvasDesign> = {
  bright: brightDesign,
  dark: darkDesign,
  "calidraw-light": calidrawLightDesign,
  "calidraw-dark": calidrawDarkDesign,
  canary: canaryDesign,
};

export function getCanvasDesign(theme: RenderTheme): CanvasDesign {
  return DESIGNS[theme];
}

export type { CanvasDesign } from "./types";
