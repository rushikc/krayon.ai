import { createRequire } from "node:module";
import { issue, type DiagramIssue } from "./issues.js";
import type { DiagramAnnotation, DiagramBadge, DiagramCard, DiagramEdge, DiagramMark, DiagramNode } from "./skeleton.js";
import {
  ATTACH_GAP,
  BASE_FONT_SIZE,
  CARD_INNER_WIDTH,
  CHAR_WIDTH_RATIO,
  DIAMOND_SCALE,
  LINE_HEIGHT_RATIO,
  NODE_MIN_HEIGHT,
  NODE_MIN_WIDTH,
  NODE_PAD,
} from "./tokens.js";
import { round2 } from "./hash.js";

const require = createRequire(import.meta.url);
const elkMod = require("elkjs/lib/elk.bundled.js") as
  | (new () => { layout: (graph: ElkGraph) => Promise<ElkGraph> })
  | { default: new () => { layout: (graph: ElkGraph) => Promise<ElkGraph> } };
const ElkConstructor = "default" in elkMod ? elkMod.default : elkMod;

type ElkGraph = {
  id: string;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
  edges?: ElkEdge[];
  width?: number;
  height?: number;
  x?: number;
  y?: number;
};

type ElkNode = {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
};

type ElkEdge = {
  id: string;
  sources: string[];
  targets: string[];
  sections?: {
    startPoint: { x: number; y: number };
    endPoint: { x: number; y: number };
    bendPoints?: { x: number; y: number }[];
  }[];
};

export type Point = { x: number; y: number };

export type LaidNode = DiagramNode & { x: number; y: number; width: number; height: number; lines: string[] };
export type LaidEdge = DiagramEdge & { points: Point[] };
export type LaidBadge = DiagramBadge & { x: number; y: number; width: number; height: number };
export type LaidAnnotation = DiagramAnnotation & { x: number; y: number; width: number; height: number };
export type LaidMark = DiagramMark & { x: number; y: number; width: number; height: number };

export type CardLayout = {
  cardId: string;
  direction: "down" | "right";
  fontSize: number;
  width: number;
  height: number;
  nodes: LaidNode[];
  edges: LaidEdge[];
  badges: LaidBadge[];
  annotations: LaidAnnotation[];
  marks: LaidMark[];
};

export type LayoutResult = {
  layouts: CardLayout[];
  issues: DiagramIssue[];
};

function wrapLabel(label: string): string[] {
  const trimmed = label.replace(/\r/g, "").trim();
  if (trimmed.includes("\n")) return trimmed.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 2);
  if (trimmed.length <= 14) return [trimmed];
  const mid = Math.ceil(trimmed.length / 2);
  let split = trimmed.lastIndexOf(" ", mid);
  if (split < 4) split = trimmed.indexOf(" ", mid);
  if (split < 4) return [trimmed.slice(0, mid), trimmed.slice(mid)];
  return [trimmed.slice(0, split), trimmed.slice(split + 1)];
}

export function measureNode(label: string, shape: DiagramNode["shape"], fontSize: number): { width: number; height: number; lines: string[] } {
  const lines = wrapLabel(label);
  const charW = CHAR_WIDTH_RATIO * fontSize;
  const lineH = LINE_HEIGHT_RATIO * fontSize;
  const maxChars = Math.max(...lines.map((line) => line.length), 1);
  let width = Math.max(NODE_MIN_WIDTH, maxChars * charW + NODE_PAD * 2);
  let height = Math.max(NODE_MIN_HEIGHT, lines.length * lineH + NODE_PAD * 2);
  if (shape === "diamond") {
    width *= DIAMOND_SCALE;
    height *= DIAMOND_SCALE;
  }
  if (shape === "ellipse") {
    width *= 1.15;
    height *= 1.1;
  }
  if (shape === "pill") {
    width += 16;
    height = Math.max(height, 96);
  }
  return { width: round2(width), height: round2(height), lines };
}

function measureTextBox(text: string, fontSize: number, extraX: number, extraY: number): { width: number; height: number } {
  const lines = wrapLabel(text);
  const charW = CHAR_WIDTH_RATIO * fontSize;
  const lineH = LINE_HEIGHT_RATIO * fontSize;
  const maxChars = Math.max(...lines.map((line) => line.length), 1);
  return {
    width: round2(Math.max(80, maxChars * charW + extraX)),
    height: round2(Math.max(28, lines.length * lineH + extraY)),
  };
}

function boxOf(item: { x: number; y: number; width: number; height: number }): { x: number; y: number; w: number; h: number } {
  return { x: item.x, y: item.y, w: item.width, h: item.height };
}

function attachAnchor(
  target: { x: number; y: number; width: number; height: number } | { points: Point[] },
): { x: number; y: number; w: number; h: number } {
  if ("points" in target) {
    const xs = target.points.map((p) => p.x);
    const ys = target.points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return boxOf(target);
}

function placeAttached(
  anchor: { x: number; y: number; w: number; h: number },
  size: { width: number; height: number },
  placement: "above" | "below" | "left" | "right",
): { x: number; y: number } {
  const { width, height } = size;
  switch (placement) {
    case "above":
      return { x: round2(anchor.x + anchor.w / 2 - width / 2), y: round2(anchor.y - height - ATTACH_GAP) };
    case "below":
      return { x: round2(anchor.x + anchor.w / 2 - width / 2), y: round2(anchor.y + anchor.h + ATTACH_GAP) };
    case "left":
      return { x: round2(anchor.x - width - ATTACH_GAP), y: round2(anchor.y + anchor.h / 2 - height / 2) };
    case "right":
      return { x: round2(anchor.x + anchor.w + ATTACH_GAP), y: round2(anchor.y + anchor.h / 2 - height / 2) };
  }
}

function scalePoint(point: Point, scale: number, ox: number, oy: number): Point {
  return { x: round2((point.x - ox) * scale), y: round2((point.y - oy) * scale) };
}

function aabbOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  pad = 1,
): boolean {
  return a.x + pad < b.x + b.w && a.x + a.w > b.x + pad && a.y + pad < b.y + b.h && a.y + a.h > b.y + pad;
}

function segmentHitsRect(
  p1: Point,
  p2: Point,
  rect: { x: number; y: number; w: number; h: number },
  inset = 8,
): boolean {
  const r = { x: rect.x + inset, y: rect.y + inset, w: rect.w - inset * 2, h: rect.h - inset * 2 };
  if (r.w <= 0 || r.h <= 0) return false;
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);
  if (maxX < r.x || minX > r.x + r.w || maxY < r.y || minY > r.y + r.h) return false;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  if (dx === 0 && dy === 0) return p1.x >= r.x && p1.x <= r.x + r.w && p1.y >= r.y && p1.y <= r.y + r.h;
  const samples = 8;
  for (let i = 1; i < samples; i += 1) {
    const t = i / samples;
    const x = p1.x + dx * t;
    const y = p1.y + dy * t;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
}

async function layoutCard(card: DiagramCard): Promise<{ layout: CardLayout; issues: DiagramIssue[] }> {
  const issues: DiagramIssue[] = [];
  const fontSize = BASE_FONT_SIZE;
  const sized = card.nodes.map((node) => ({ node, size: measureNode(node.label, node.shape, fontSize) }));
  const elk = new ElkConstructor();
  const graph: ElkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": card.direction === "right" ? "RIGHT" : "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "56",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.randomSeed": "1",
      "elk.padding": "[top=8,left=8,bottom=8,right=8]",
    },
    children: sized.map(({ node, size }) => ({ id: node.id, width: size.width, height: size.height })),
    edges: card.edges.map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
  };
  const laid = await elk.layout(graph);
  const childMap = new Map((laid.children ?? []).map((child) => [child.id, child]));
  const edgeMap = new Map((laid.edges ?? []).map((edge) => [edge.id, edge]));

  let nodes: LaidNode[] = sized.map(({ node, size }) => {
    const child = childMap.get(node.id);
    return {
      ...node,
      x: round2(child?.x ?? 0),
      y: round2(child?.y ?? 0),
      width: size.width,
      height: size.height,
      lines: size.lines,
    };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  let edges: LaidEdge[] = card.edges.map((edge) => {
    const elkEdge = edgeMap.get(edge.id);
    const sections = elkEdge?.sections ?? [];
    const points: Point[] = [];
    for (const section of sections) {
      points.push({ x: round2(section.startPoint.x), y: round2(section.startPoint.y) });
      for (const bend of section.bendPoints ?? []) points.push({ x: round2(bend.x), y: round2(bend.y) });
      points.push({ x: round2(section.endPoint.x), y: round2(section.endPoint.y) });
    }
    if (points.length < 2) {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (from && to) {
        points.push({ x: round2(from.x + from.width / 2), y: round2(from.y + from.height) });
        points.push({ x: round2(to.x + to.width / 2), y: round2(to.y) });
      }
    }
    return { ...edge, points };
  });

  const nodeByIdUnscaled = new Map(nodes.map((node) => [node.id, node]));
  const edgeByIdUnscaled = new Map(edges.map((edge) => [edge.id, edge]));
  const targetOfUnscaled = (id: string) => nodeByIdUnscaled.get(id) ?? edgeByIdUnscaled.get(id);

  let badges: LaidBadge[] = card.badges.map((badge) => {
    const size = measureTextBox(badge.text, fontSize, 48, 20);
    size.height = Math.max(size.height, 40);
    const target = targetOfUnscaled(badge.attachTo);
    const pos = target ? placeAttached(attachAnchor(target), size, badge.placement) : { x: 0, y: 0 };
    return { ...badge, ...pos, width: size.width, height: size.height };
  });

  let annotations: LaidAnnotation[] = card.annotations.map((annotation) => {
    const size = measureTextBox(annotation.text, fontSize, 16, 8);
    const target = targetOfUnscaled(annotation.attachTo);
    const pos = target ? placeAttached(attachAnchor(target), size, annotation.placement) : { x: 0, y: 0 };
    return { ...annotation, ...pos, width: size.width, height: size.height };
  });

  let marks: LaidMark[] = card.marks.map((mark) => {
    const target = targetOfUnscaled(mark.attachTo);
    const anchor = target ? attachAnchor(target) : { x: 0, y: 0, w: 80, h: 80 };
    const size = Math.max(36, Math.min(anchor.w, anchor.h) * 0.55);
    return {
      ...mark,
      x: round2(anchor.x + anchor.w / 2 - size / 2),
      y: round2(anchor.y + anchor.h / 2 - size / 2),
      width: round2(size),
      height: round2(size),
    };
  });

  const xs: number[] = [];
  const ys: number[] = [];
  const pushBox = (item: { x: number; y: number; width: number; height: number }) => {
    xs.push(item.x, item.x + item.width);
    ys.push(item.y, item.y + item.height);
  };
  for (const node of nodes) pushBox(node);
  for (const badge of badges) pushBox(badge);
  for (const annotation of annotations) pushBox(annotation);
  for (const mark of marks) pushBox(mark);
  for (const edge of edges) {
    for (const point of edge.points) {
      xs.push(point.x);
      ys.push(point.y);
    }
  }
  const minX = Math.min(...xs, 0);
  const minY = Math.min(...ys, 0);
  const maxX = Math.max(...xs, 0);
  const contentW = Math.max(maxX - minX, 1);
  let scale = CARD_INNER_WIDTH / contentW;
  if (scale < 1) {
    issues.push(
      issue(
        "TEXT_TOO_SMALL",
        "error",
        `Layout width ${round2(contentW)}px does not fit ${CARD_INNER_WIDTH}px without shrinking fonts below ${BASE_FONT_SIZE}px`,
        { cardId: card.id },
      ),
    );
    scale = 1;
  }
  const appliedFont = fontSize;

  const shift = (x: number, y: number) => scalePoint({ x, y }, scale, minX, minY);
  nodes = nodes.map((node) => ({
    ...node,
    ...shift(node.x, node.y),
    width: round2(node.width * scale),
    height: round2(node.height * scale),
  }));
  edges = edges.map((edge) => ({
    ...edge,
    points: edge.points.map((point) => shift(point.x, point.y)),
  }));
  badges = badges.map((badge) => ({
    ...badge,
    ...shift(badge.x, badge.y),
    width: round2(badge.width * scale),
    height: round2(badge.height * scale),
  }));
  annotations = annotations.map((annotation) => ({
    ...annotation,
    ...shift(annotation.x, annotation.y),
    width: round2(annotation.width * scale),
    height: round2(annotation.height * scale),
  }));
  marks = marks.map((mark) => ({
    ...mark,
    ...shift(mark.x, mark.y),
    width: round2(mark.width * scale),
    height: round2(mark.height * scale),
  }));

  const allBoxes = [...nodes, ...badges, ...annotations];
  const minAllX = Math.min(...allBoxes.map((b) => b.x), 0);
  const minAllY = Math.min(...allBoxes.map((b) => b.y), 0);
  if (minAllX < 0 || minAllY < 0) {
    const dx = minAllX < 0 ? -minAllX : 0;
    const dy = minAllY < 0 ? -minAllY : 0;
    const move = <T extends { x: number; y: number }>(item: T): T => ({ ...item, x: round2(item.x + dx), y: round2(item.y + dy) });
    for (let i = 0; i < nodes.length; i += 1) nodes[i] = move(nodes[i]!);
    for (let i = 0; i < badges.length; i += 1) badges[i] = move(badges[i]!);
    for (let i = 0; i < annotations.length; i += 1) annotations[i] = move(annotations[i]!);
    for (let i = 0; i < marks.length; i += 1) marks[i] = move(marks[i]!);
    edges = edges.map((edge) => ({
      ...edge,
      points: edge.points.map((p) => ({ x: round2(p.x + dx), y: round2(p.y + dy) })),
    }));
  }

  const maxAllX = Math.max(
    ...nodes.map((n) => n.x + n.width),
    ...badges.map((b) => b.x + b.width),
    ...annotations.map((a) => a.x + a.width),
    ...marks.map((m) => m.x + m.width),
    ...edges.flatMap((e) => e.points.map((p) => p.x)),
    0,
  );
  const maxAllY = Math.max(
    ...nodes.map((n) => n.y + n.height),
    ...badges.map((b) => b.y + b.height),
    ...annotations.map((a) => a.y + a.height),
    ...marks.map((m) => m.y + m.height),
    ...edges.flatMap((e) => e.points.map((p) => p.y)),
    0,
  );

  if (maxAllX > CARD_INNER_WIDTH + 0.5) {
    issues.push(
      issue("OUT_OF_BOUNDS", "error", `Card content width ${round2(maxAllX)}px exceeds ${CARD_INNER_WIDTH}px`, {
        cardId: card.id,
      }),
    );
  }

  const solids = [
    ...nodes.map((n) => ({ id: n.id, box: boxOf(n), step: n.step, kind: "node" as const })),
    ...badges.map((b) => ({ id: b.id, box: boxOf(b), step: b.step, kind: "badge" as const })),
    ...annotations.map((a) => ({ id: a.id, box: boxOf(a), step: a.step, kind: "annotation" as const })),
  ];
  for (let i = 0; i < solids.length; i += 1) {
    for (let j = i + 1; j < solids.length; j += 1) {
      const a = solids[i]!;
      const b = solids[j]!;
      if (aabbOverlap(a.box, b.box)) {
        issues.push(
          issue("OVERLAP", "error", `"${a.id}" overlaps "${b.id}"`, {
            cardId: card.id,
            elementId: a.id,
            step: Math.max(a.step, b.step),
          }),
        );
      }
    }
  }

  for (const edge of edges) {
    const skip = new Set([edge.from, edge.to]);
    for (const node of nodes) {
      if (skip.has(node.id)) continue;
      const rect = boxOf(node);
      for (let i = 0; i < edge.points.length - 1; i += 1) {
        if (segmentHitsRect(edge.points[i]!, edge.points[i + 1]!, rect)) {
          issues.push(
            issue("EDGE_CROSSES_NODE", "error", `Edge "${edge.id}" crosses node "${node.id}"`, {
              cardId: card.id,
              elementId: edge.id,
              step: Math.max(edge.step, node.step),
            }),
          );
          break;
        }
      }
    }
  }

  return {
    layout: {
      cardId: card.id,
      direction: card.direction,
      fontSize: appliedFont,
      width: round2(Math.min(maxAllX, CARD_INNER_WIDTH)),
      height: round2(maxAllY),
      nodes,
      edges,
      badges,
      annotations,
      marks,
    },
    issues,
  };
}

export async function layoutSkeleton(cards: DiagramCard[]): Promise<LayoutResult> {
  const layouts: CardLayout[] = [];
  const issues: DiagramIssue[] = [];
  for (const card of cards) {
    const result = await layoutCard(card);
    layouts.push(result.layout);
    issues.push(...result.issues);
  }
  return { layouts, issues };
}

export function elementsVisibleAt(layout: CardLayout, step: number): CardLayout {
  return {
    ...layout,
    nodes: layout.nodes.filter((item) => item.step <= step),
    edges: layout.edges.filter((item) => item.step <= step),
    badges: layout.badges.filter((item) => item.step <= step),
    annotations: layout.annotations.filter((item) => item.step <= step),
    marks: layout.marks.filter((item) => item.step <= step),
  };
}
