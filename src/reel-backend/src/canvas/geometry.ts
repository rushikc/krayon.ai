import { isBoxNode, type BoxNode, type CanvasElement, type NumberNode } from "./types.js";

export interface ArrowGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const MATRIX_COLS = 18;
export const MATRIX_ROWS = 32;
export const CELL_WIDTH = 100 / MATRIX_COLS;
export const CELL_HEIGHT = 100 / MATRIX_ROWS;

const ENDPOINT_GAP = 0.75;
export const MIN_NUMBER_SIZE = 4;
export const MAX_NUMBER_SIZE = 40;
export const DEFAULT_BOX_FONT_SIZE = 14;
export const MIN_BOX_FONT_SIZE = 10;
export const MAX_BOX_FONT_SIZE = 48;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

export function normalizeMatrix(matrix: readonly number[]): [number, number, number, number] {
  if (matrix.length === 2) {
    const x = matrix[0] ?? 0;
    const y = matrix[1] ?? 0;
    return [x, y, x, y];
  }
  return [matrix[0] ?? 0, matrix[1] ?? 0, matrix[2] ?? matrix[0] ?? 0, matrix[3] ?? matrix[1] ?? 0];
}

export function matrixToPercents(matrix: readonly number[]): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const [x1, y1, x2, y2] = normalizeMatrix(matrix);
  return {
    left: x1 * CELL_WIDTH,
    top: y1 * CELL_HEIGHT,
    width: (x2 - x1 + 1) * CELL_WIDTH,
    height: (y2 - y1 + 1) * CELL_HEIGHT,
  };
}

export function clampNumberSize(value: number): number {
  return roundPercent(clamp(value, MIN_NUMBER_SIZE, MAX_NUMBER_SIZE));
}

export function numberBadgeSize(node: NumberNode): number {
  if (node.size != null) {
    return clampNumberSize(node.size);
  }
  return matrixToPercents(node.matrix).width;
}

function getRectIntersectionScale(rect: { width: number; height: number }, dx: number, dy: number) {
  const horizontalScale = dx === 0 ? Number.POSITIVE_INFINITY : rect.width / 2 / Math.abs(dx);
  const verticalScale = dy === 0 ? Number.POSITIVE_INFINITY : rect.height / 2 / Math.abs(dy);
  return Math.min(horizontalScale, verticalScale);
}

export function findBoxById(elements: CanvasElement[], id: string): BoxNode | undefined {
  return elements.find((element): element is BoxNode => isBoxNode(element) && element.id === id);
}

export function getArrowGeometry(source: BoxNode, target: BoxNode): ArrowGeometry | null {
  const sourceRect = matrixToPercents(source.matrix);
  const targetRect = matrixToPercents(target.matrix);
  const sourceCenter = {
    x: sourceRect.left + sourceRect.width / 2,
    y: sourceRect.top + sourceRect.height / 2,
  };
  const targetCenter = {
    x: targetRect.left + targetRect.width / 2,
    y: targetRect.top + targetRect.height / 2,
  };

  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    return null;
  }

  const sourceScale = getRectIntersectionScale(sourceRect, dx, dy);
  const targetScale = getRectIntersectionScale(targetRect, dx, dy);
  const unitX = dx / distance;
  const unitY = dy / distance;

  return {
    x1: sourceCenter.x + dx * sourceScale + unitX * ENDPOINT_GAP,
    y1: sourceCenter.y + dy * sourceScale + unitY * ENDPOINT_GAP,
    x2: targetCenter.x - dx * targetScale - unitX * ENDPOINT_GAP,
    y2: targetCenter.y - dy * targetScale - unitY * ENDPOINT_GAP,
  };
}
