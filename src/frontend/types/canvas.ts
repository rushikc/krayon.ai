export type ColorTheme =
  | "ink"
  | "violet"
  | "green"
  | "blue"
  | "sky"
  | "lavender"
  | "mint"
  | "tan"
  | "yellow"
  | "orange"
  | "pink"
  | "salmon";

export type ArrowVariant = "solid" | "dashed";

/** Absolute seconds on the reel timeline. track 0 = top = highest z-index. */
export interface ElementTime {
  start: number;
  end: number;
  track: number;
}

/** Inclusive cell span on the 18×32 reel grid. Length 2 is a single cell. */
export type GridMatrix =
  | readonly [number, number]
  | readonly [number, number, number, number];

/**
 * Box occupies cells [X1, Y1] through [X2, Y2] inclusive on the 18×32 grid.
 */
export interface BoxNode {
  id: string;
  type: "box";
  matrix: readonly [number, number, number, number];
  label: string;
  sublabel?: string;
  /** Label font size in px. Omit to use the default (14). */
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

/**
 * Circular numbered badge. `matrix` is `[X, Y]` (one cell) or `[X1, Y1, X2, Y2]`.
 * Optional `size` is diameter as % of canvas width and overrides matrix width.
 */
export interface NumberNode {
  id: string;
  type: "number";
  matrix: GridMatrix;
  /** Diameter as % of canvas width (4–40). Omit to size from `matrix`. */
  size?: number;
  value: number;
  colorTheme: ColorTheme;
  time: ElementTime;
}

export interface DiagramNode {
  id: string;
  type: "diagram";
  cardId: string;
  step: number;
  at: number;
  title: string;
  caption: string;
  pngUrl: string;
  time: ElementTime;
}

export type CanvasElement = BoxNode | ArrowNode | NumberNode | DiagramNode;

export function isBoxNode(element: CanvasElement): element is BoxNode {
  return element.type === "box";
}

export function isArrowNode(element: CanvasElement): element is ArrowNode {
  return element.type === "arrow";
}

export function isNumberNode(element: CanvasElement): element is NumberNode {
  return element.type === "number";
}

export function isDiagramNode(element: CanvasElement): element is DiagramNode {
  return element.type === "diagram";
}

export function getElementLabel(element: CanvasElement): string {
  if (isBoxNode(element)) {
    return element.label;
  }
  if (isNumberNode(element)) {
    return String(element.value);
  }
  if (isDiagramNode(element)) {
    const caption = element.caption.trim();
    if (caption) {
      return caption;
    }
    return `${element.cardId} · step ${String(element.step).padStart(2, "0")}`;
  }
  return `${element.sourceId} → ${element.targetId}`;
}
