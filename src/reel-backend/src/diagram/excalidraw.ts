import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hashId } from "./hash.js";
import type { CardLayout, LaidAnnotation, LaidBadge, LaidEdge, LaidMark, LaidNode } from "./layout.js";
import { elementsVisibleAt } from "./layout.js";
import { cardStatePath, type ReelPaths } from "./paths.js";
import type { DiagramCard } from "./skeleton.js";
import { rushkColors } from "./tokens.js";

export type ExcalidrawElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  opacity?: number;
  seed?: number;
  version?: number;
  versionNonce?: number;
  updated?: number;
  isDeleted?: boolean;
  groupIds?: string[];
  boundElements?: { id: string; type: string }[] | null;
  link?: string | null;
  locked?: boolean;
  fontSize?: number;
  fontFamily?: number;
  text?: string;
  label?: { text: string; fontSize?: number; strokeColor?: string; fontFamily?: number };
  start?: { id: string };
  end?: { id: string };
  points?: [number, number][];
  roundness?: { type: number } | null;
  containerId?: string | null;
  originalText?: string;
  autoResize?: boolean;
  lineHeight?: number;
  baseline?: number;
  textAlign?: string;
  verticalAlign?: string;
  startBinding?: { elementId: string; focus: number; gap: number } | null;
  endBinding?: { elementId: string; focus: number; gap: number } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  customData?: { rushk: { cardId: string; step: number; at: number } };
  [key: string]: unknown;
};

export type ExcalidrawFile = {
  type: "excalidraw";
  version: 2;
  source?: string;
  elements: ExcalidrawElement[];
  appState: { viewBackgroundColor: string };
  files: Record<string, never>;
};

export type HandFont = { name: string; id: number };

let cachedFont: HandFont | undefined;
let convertFn: ((elements: ExcalidrawElement[], opts?: { regenerateIds: boolean }) => ExcalidrawElement[]) | undefined;
let convertTried = false;

export async function loadExcalidrawRuntime(): Promise<{
  font: HandFont;
  convert: ((elements: ExcalidrawElement[], opts?: { regenerateIds: boolean }) => ExcalidrawElement[]) | undefined;
}> {
  if (!convertTried) {
    convertTried = true;
    try {
      const mod = (await import("@excalidraw/excalidraw")) as {
        FONT_FAMILY: Record<string, number>;
        convertToExcalidrawElements: (
          elements: ExcalidrawElement[],
          opts?: { regenerateIds: boolean },
        ) => ExcalidrawElement[];
      };
      const family = mod.FONT_FAMILY;
      const name = "Excalifont" in family ? "Excalifont" : "Virgil" in family ? "Virgil" : Object.keys(family)[0] ?? "Excalifont";
      cachedFont = { name, id: family[name] ?? 1 };
      convertFn = mod.convertToExcalidrawElements;
    } catch {
      cachedFont = { name: "Excalifont", id: 5 };
      convertFn = undefined;
    }
  }
  return { font: cachedFont ?? { name: "Excalifont", id: 5 }, convert: convertFn };
}

function toneStroke(tone: LaidNode["tone"]): string {
  const colors = rushkColors();
  switch (tone) {
    case "red":
      return colors.annotationRed;
    case "green":
      return colors.success;
    case "ink":
      return colors.ink;
    default:
      return colors.strokeBlue;
  }
}

function nodeType(shape: LaidNode["shape"]): "rectangle" | "diamond" | "ellipse" {
  if (shape === "diamond") return "diamond";
  if (shape === "ellipse") return "ellipse";
  return "rectangle";
}

function rushk(cardId: string, step: number, at: number) {
  return { rushk: { cardId, step, at } };
}

function stamp(el: ExcalidrawElement, cardId: string, step: number, at: number, id = el.id): ExcalidrawElement {
  const seed = hashId(id);
  return {
    ...el,
    id,
    seed,
    version: 1,
    versionNonce: seed,
    updated: 1,
    isDeleted: false,
    roughness: el.roughness ?? 1,
    customData: rushk(cardId, step, at),
  };
}

function nodeSkeleton(node: LaidNode, font: HandFont, fontSize: number, cardId: string, at: number): ExcalidrawElement {
  const colors = rushkColors();
  const rounded = node.shape === "rounded" || node.shape === "pill";
  return {
    id: node.id,
    type: nodeType(node.shape),
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    strokeColor: toneStroke(node.tone),
    backgroundColor: colors.card,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: rounded ? { type: node.shape === "pill" ? 3 : 3 } : null,
    label: {
      text: node.lines.join("\n"),
      fontSize: fontSize,
      fontFamily: font.id,
      strokeColor: colors.ink,
    },
    fontFamily: font.id,
    customData: rushk(cardId, node.step, at),
  };
}

function edgeSkeleton(edge: LaidEdge, font: HandFont, fontSize: number, cardId: string, at: number): ExcalidrawElement {
  const colors = rushkColors();
  const start = edge.points[0] ?? { x: 0, y: 0 };
  const points: [number, number][] = edge.points.map((point) => [point.x - start.x, point.y - start.y]);
  if (points.length < 2) points.push([0, 0], [0, 80]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const el: ExcalidrawElement = {
    id: edge.id,
    type: "arrow",
    x: start.x,
    y: start.y,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    strokeColor: colors.strokeBlue,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: edge.style === "dashed" ? "dashed" : "solid",
    roughness: 1,
    opacity: 100,
    points,
    start: { id: edge.from },
    end: { id: edge.to },
    startArrowhead: null,
    endArrowhead: "arrow",
    fontFamily: font.id,
    customData: rushk(cardId, edge.step, at),
  };
  if (edge.label) {
    el.label = { text: edge.label, fontSize, fontFamily: font.id, strokeColor: colors.ink };
  }
  return el;
}

function badgeSkeleton(badge: LaidBadge, font: HandFont, fontSize: number, cardId: string, at: number): ExcalidrawElement {
  const colors = rushkColors();
  return {
    id: badge.id,
    type: "rectangle",
    x: badge.x,
    y: badge.y,
    width: badge.width,
    height: badge.height,
    strokeColor: colors.badgeBlue,
    backgroundColor: colors.badgeBlue,
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: { type: 3 },
    label: {
      text: badge.text,
      fontSize: fontSize,
      fontFamily: font.id,
      strokeColor: colors.badgeText,
    },
    customData: rushk(cardId, badge.step, at),
  };
}

function annotationSkeleton(annotation: LaidAnnotation, font: HandFont, fontSize: number, cardId: string, at: number): ExcalidrawElement {
  const colors = rushkColors();
  return {
    id: annotation.id,
    type: "text",
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height,
    text: annotation.text,
    originalText: annotation.text,
    fontSize,
    fontFamily: font.id,
    strokeColor: colors.annotationRed,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    textAlign: "left",
    verticalAlign: "top",
    customData: rushk(cardId, annotation.step, at),
  };
}

function markSkeletons(mark: LaidMark, cardId: string, at: number): ExcalidrawElement[] {
  const colors = rushkColors();
  if (mark.kind === "check") {
    const points: [number, number][] = [
      [0, mark.height * 0.45],
      [mark.width * 0.35, mark.height * 0.85],
      [mark.width, mark.height * 0.1],
    ];
    return [
      {
        id: mark.id,
        type: "line",
        x: mark.x,
        y: mark.y,
        width: mark.width,
        height: mark.height,
        points,
        strokeColor: colors.success,
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 4,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        customData: rushk(cardId, mark.step, at),
      },
    ];
  }
  return [
    {
      id: `${mark.id}-a`,
      type: "line",
      x: mark.x,
      y: mark.y,
      width: mark.width,
      height: mark.height,
      points: [
        [0, 0],
        [mark.width, mark.height],
      ],
      strokeColor: colors.annotationRed,
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 4,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      customData: rushk(cardId, mark.step, at),
    },
    {
      id: `${mark.id}-b`,
      type: "line",
      x: mark.x,
      y: mark.y,
      width: mark.width,
      height: mark.height,
      points: [
        [mark.width, 0],
        [0, mark.height],
      ],
      strokeColor: colors.annotationRed,
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 4,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      customData: rushk(cardId, mark.step, at),
    },
  ];
}

function stepAt(card: DiagramCard, step: number): number {
  return card.steps.find((item) => item.step === step)?.at ?? 0;
}

export function buildSkeletons(layout: CardLayout, card: DiagramCard, font: HandFont): ExcalidrawElement[] {
  const out: ExcalidrawElement[] = [];
  const fontSize = layout.fontSize;
  for (const node of layout.nodes) out.push(nodeSkeleton(node, font, fontSize, card.id, stepAt(card, node.step)));
  for (const edge of layout.edges) out.push(edgeSkeleton(edge, font, fontSize, card.id, stepAt(card, edge.step)));
  for (const badge of layout.badges) out.push(badgeSkeleton(badge, font, fontSize, card.id, stepAt(card, badge.step)));
  for (const annotation of layout.annotations) {
    out.push(annotationSkeleton(annotation, font, fontSize, card.id, stepAt(card, annotation.step)));
  }
  for (const mark of layout.marks) out.push(...markSkeletons(mark, card.id, stepAt(card, mark.step)));
  return out;
}

function parentRushk(elements: ExcalidrawElement[], id: string | null | undefined): ExcalidrawElement["customData"] {
  if (!id) return undefined;
  return elements.find((el) => el.id === id)?.customData;
}

export function stampAll(elements: ExcalidrawElement[], fallback: { cardId: string; step: number; at: number }): ExcalidrawElement[] {
  const byId = new Map(elements.map((el) => [el.id, el]));
  return elements.map((el) => {
    const fromContainer = parentRushk(elements, typeof el.containerId === "string" ? el.containerId : undefined);
    const bound =
      el.startBinding && byId.get(el.startBinding.elementId)?.customData
        ? byId.get(el.startBinding.elementId)?.customData
        : undefined;
    const data = el.customData ?? fromContainer ?? bound ?? { rushk: fallback };
    return stamp({ ...el, customData: data }, data.rushk.cardId, data.rushk.step, data.rushk.at, el.id);
  });
}

export async function toExcalidrawElements(
  layout: CardLayout,
  card: DiagramCard,
): Promise<{ elements: ExcalidrawElement[]; font: HandFont }> {
  const { font, convert } = await loadExcalidrawRuntime();
  const skeletons = buildSkeletons(layout, card, font);
  let elements = skeletons;
  if (convert) {
    try {
      const converted = convert(skeletons, { regenerateIds: false });
      const sized = new Map(skeletons.map((el) => [el.id, el]));
      elements = converted.map((el) => {
        const src = sized.get(el.id);
        if (!src) return el;
        return {
          ...el,
          x: src.x,
          y: src.y,
          width: src.width,
          height: src.height,
          fontFamily: src.fontFamily ?? el.fontFamily,
          fontSize: src.fontSize ?? src.label?.fontSize ?? el.fontSize,
        };
      });
    } catch {
      elements = skeletons;
    }
  }
  const last = card.steps[card.steps.length - 1];
  return {
    elements: stampAll(elements, { cardId: card.id, step: last?.step ?? 1, at: last?.at ?? 0 }),
    font,
  };
}

export function excalidrawFile(elements: ExcalidrawElement[]): ExcalidrawFile {
  return {
    type: "excalidraw",
    version: 2,
    elements,
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  };
}

export async function writeCardStates(
  paths: ReelPaths,
  card: DiagramCard,
  layout: CardLayout,
): Promise<{ steps: { step: number; at: number; elements: ExcalidrawElement[]; filePath: string }[] }> {
  const steps = [...card.steps].sort((a, b) => a.step - b.step);
  const out: { step: number; at: number; elements: ExcalidrawElement[]; filePath: string }[] = [];
  for (const item of steps) {
    const visible = elementsVisibleAt(layout, item.step);
    const { elements } = await toExcalidrawElements(visible, card);
    const filePath = cardStatePath(paths, card.id, item.step);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(excalidrawFile(elements), null, 2)}\n`);
    out.push({ step: item.step, at: item.at, elements, filePath });
  }
  return { steps: out };
}
