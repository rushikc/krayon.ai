import { convertToExcalidrawElements, exportToBlob } from "@excalidraw/excalidraw";
import css from "@excalidraw/excalidraw/index.css";

const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  originalText?: string;
  fontSize?: number;
  fontFamily?: number;
  containerId?: string | null;
  points?: [number, number][];
  label?: { text: string };
  start?: { id: string };
  end?: { id: string };
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  customData?: { rushk?: { cardId: string; step: number; at: number } };
};

type Issue = {
  code: string;
  severity: "error" | "warning";
  cardId?: string;
  step?: number;
  elementId?: string;
  message: string;
};

function box(el: El) {
  if (el.points && el.points.length) {
    const xs = el.points.map((p) => el.x + p[0]);
    const ys = el.points.map((p) => el.y + p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: el.x, y: el.y, w: el.width, h: el.height };
}

function overlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function measure(elements: El[], cardWidth: number): Issue[] {
  const issues: Issue[] = [];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const solids = elements.filter((el) => el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse");
  for (const el of elements) {
    const rushk = el.customData?.rushk;
    if (el.type === "text" && ctx) {
      const text = el.originalText || el.text || "";
      const fontSize = el.fontSize ?? 20;
      ctx.font = `${fontSize}px Virgil, Excalifont, cursive`;
      const width = Math.max(...text.split("\n").map((line) => ctx.measureText(line).width), 0);
      const container = el.containerId ? elements.find((item) => item.id === el.containerId) : el;
      const maxW = container ? Math.max(container.width - 8, 1) : el.width;
      if (width > maxW + 1) {
        issues.push({
          code: "TEXT_OVERFLOW",
          severity: "error",
          cardId: rushk?.cardId,
          step: rushk?.step,
          elementId: el.id,
          message: `Text "${text.slice(0, 24)}" is ${Math.round(width)}px wide in a ${Math.round(maxW)}px box`,
        });
      }
    }
    const b = box(el);
    if (b.x + b.w > cardWidth + 1) {
      issues.push({
        code: "OUT_OF_BOUNDS",
        severity: "error",
        cardId: rushk?.cardId,
        step: rushk?.step,
        elementId: el.id,
        message: `Element "${el.id}" extends to x=${Math.round(b.x + b.w)} beyond ${cardWidth}`,
      });
    }
  }
  for (let i = 0; i < solids.length; i += 1) {
    for (let j = i + 1; j < solids.length; j += 1) {
      const a = solids[i]!;
      const b = solids[j]!;
      if (overlap(box(a), box(b))) {
        issues.push({
          code: "OVERLAP",
          severity: "error",
          cardId: a.customData?.rushk?.cardId,
          step: Math.max(a.customData?.rushk?.step ?? 1, b.customData?.rushk?.step ?? 1),
          elementId: a.id,
          message: `"${a.id}" overlaps "${b.id}"`,
        });
      }
    }
  }
  const arrows = elements.filter((el) => el.type === "arrow");
  for (const arrow of arrows) {
    const pts = (arrow.points ?? []).map((p) => ({ x: arrow.x + p[0], y: arrow.y + p[1] }));
    const skip = new Set<string>([
      arrow.start?.id,
      arrow.end?.id,
      arrow.startBinding?.elementId,
      arrow.endBinding?.elementId,
    ].filter((id): id is string => Boolean(id)));
    for (const node of solids) {
      if (node.id === arrow.id || skip.has(node.id)) continue;
      const r = box(node);
      const inset = 10;
      const inner = { x: r.x + inset, y: r.y + inset, w: r.w - inset * 2, h: r.h - inset * 2 };
      for (let i = 0; i < pts.length - 1; i += 1) {
        const p1 = pts[i]!;
        const p2 = pts[i + 1]!;
        const samples = 6;
        let hit = false;
        for (let s = 1; s < samples; s += 1) {
          const t = s / samples;
          const x = p1.x + (p2.x - p1.x) * t;
          const y = p1.y + (p2.y - p1.y) * t;
          if (x >= inner.x && x <= inner.x + inner.w && y >= inner.y && y <= inner.y + inner.h) {
            hit = true;
            break;
          }
        }
        if (hit) {
          issues.push({
            code: "EDGE_CROSSES_NODE",
            severity: "error",
            cardId: arrow.customData?.rushk?.cardId,
            step: arrow.customData?.rushk?.step,
            elementId: arrow.id,
            message: `Edge "${arrow.id}" crosses node "${node.id}"`,
          });
          break;
        }
      }
    }
  }
  return issues;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

async function renderScene(payload: {
  elements: El[];
  exportPadding: number;
  scale: number;
  cardWidth: number;
}): Promise<{ pngBase64: string; issues: Issue[] }> {
  await document.fonts.ready.catch(() => undefined);
  let elements = payload.elements;
  if (elements.some((el) => el.label)) {
    const sized = new Map(payload.elements.map((el) => [el.id, el]));
    try {
      elements = convertToExcalidrawElements(elements as never, { regenerateIds: false }) as El[];
      elements = elements.map((el) => {
        const src = sized.get(el.id);
        if (!src) return el;
        return { ...el, x: src.x, y: src.y, width: src.width, height: src.height };
      });
    } catch {
      elements = payload.elements;
    }
  }
  const blob = await exportToBlob({
    elements: elements as never,
    mimeType: "image/png",
    exportPadding: payload.exportPadding,
    files: {},
    appState: {
      exportBackground: true,
      viewBackgroundColor: "#ffffff",
      exportWithDarkMode: false,
    },
    getDimensions: (width: number, height: number) => ({
      width: width * payload.scale,
      height: height * payload.scale,
      scale: payload.scale,
    }),
  });
  const pngBase64 = await blobToBase64(blob);
  return { pngBase64, issues: measure(elements, payload.cardWidth) };
}

Object.assign(window, { __KRAYON_RENDER__: renderScene });
