export const COLOR_THEMES = [
  "ink",
  "violet",
  "green",
  "blue",
  "sky",
  "lavender",
  "mint",
  "tan",
  "yellow",
  "orange",
  "pink",
  "salmon",
] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number];

export type ArrowVariant = "solid" | "dashed";

export interface ElementTime {
  start: number;
  end: number;
  track: number;
}

export type GridMatrix =
  | readonly [number, number]
  | readonly [number, number, number, number];

export interface BoxNode {
  id: string;
  type: "box";
  matrix: readonly [number, number, number, number];
  label: string;
  sublabel?: string;
  fontSize?: number;
  colorTheme: ColorTheme;
  time: ElementTime;
}

export interface ArrowNode {
  id: string;
  type: "arrow";
  sourceId: string;
  targetId: string;
  variant?: ArrowVariant;
  time: ElementTime;
}

export interface NumberNode {
  id: string;
  type: "number";
  matrix: GridMatrix;
  size?: number;
  value: number;
  colorTheme: ColorTheme;
  time: ElementTime;
}

export type CanvasElement = BoxNode | ArrowNode | NumberNode;

export function isBoxNode(element: CanvasElement): element is BoxNode {
  return element.type === "box";
}

export function isArrowNode(element: CanvasElement): element is ArrowNode {
  return element.type === "arrow";
}

export function isNumberNode(element: CanvasElement): element is NumberNode {
  return element.type === "number";
}
