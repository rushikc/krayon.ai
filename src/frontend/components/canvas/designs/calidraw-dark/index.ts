import "@fontsource/architects-daughter";

import "./palette.css";

import type { CanvasDesign } from "../types";
import { Arrow } from "./Arrow";
import { Box } from "./Box";
import {
  exportBackground,
  exportBackgroundImage,
  exportBackgroundPosition,
  exportBackgroundRepeat,
  exportBackgroundSize,
  frameClassName,
  frameStyle,
} from "./frame";
import { Markers } from "./markers";
import { Number } from "./Number";
import skill from "./SKILL.md?raw";

export const calidrawDarkDesign: CanvasDesign = {
  Box,
  Number,
  Arrow,
  Markers,
  frameClassName,
  frameStyle,
  exportBackground,
  exportBackgroundImage,
  exportBackgroundSize,
  exportBackgroundPosition,
  exportBackgroundRepeat,
  skill,
};
