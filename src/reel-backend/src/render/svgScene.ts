import {
  DEFAULT_BOX_FONT_SIZE,
  findBoxById,
  getArrowGeometry,
  matrixToPercents,
  numberBadgeSize,
} from "../canvas/geometry.js";
import { isArrowNode, isBoxNode, isNumberNode, type CanvasElement } from "../canvas/types.js";
import { isElementActiveAt } from "../canvas/visibility.js";
import { BRIGHT, fillFor, textOn } from "./palette.js";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function truncate(text: string, maxChars: number): string {
  if (maxChars <= 1) return "…";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

export function sceneToSvg(
  elements: CanvasElement[],
  time: number,
  width: number,
  height: number,
): string {
  const px = (pct: number) => (pct / 100) * width;
  const py = (pct: number) => (pct / 100) * height;
  const visible = [...elements]
    .filter((el) => isElementActiveAt(el.time, time))
    .sort((a, b) => b.time.track - a.time.track);
  const boxes = elements.filter(isBoxNode);

  const parts: string[] = [];
  parts.push(
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${BRIGHT.surface}"/>`,
  );

  const arrows = visible.filter(isArrowNode);
  for (const arrow of arrows) {
    const source = findBoxById(boxes, arrow.sourceId);
    const target = findBoxById(boxes, arrow.targetId);
    if (!source || !target) continue;
    const geo = getArrowGeometry(source, target);
    if (!geo) continue;
    const x1 = px(geo.x1);
    const y1 = py(geo.y1);
    const x2 = px(geo.x2);
    const y2 = py(geo.y2);
    const dash = arrow.variant === "dashed" ? ` stroke-dasharray="${(6 / 100) * width} ${(5 / 100) * width}"` : "";
    const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    const head = Math.max(10, width * 0.012);
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${BRIGHT.ink}" stroke-width="2.5" stroke-linecap="round"${dash}/>`,
    );
    parts.push(
      `<polygon points="0,0 ${-head},${head / 2} ${-head},${-head / 2}" fill="${BRIGHT.ink}" transform="translate(${x2} ${y2}) rotate(${angle})"/>`,
    );
  }

  for (const node of visible) {
    if (isBoxNode(node)) {
      const rect = matrixToPercents(node.matrix);
      const x = px(rect.left);
      const y = py(rect.top);
      const w = px(rect.width);
      const h = py(rect.height);
      const r = 8;
      const fill = fillFor(node.colorTheme);
      const ink = textOn(node.colorTheme);
      const fontSize = node.fontSize ?? DEFAULT_BOX_FONT_SIZE;
      const pad = 12;
      const maxChars = Math.max(4, Math.floor((w - pad * 2) / (fontSize * 0.55)));
      const label = truncate(node.label, maxChars);
      const hasSub = Boolean(node.sublabel);
      parts.push(`<g>`);
      parts.push(
        `<rect x="${x + 3}" y="${y + 3}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${BRIGHT.ink}"/>`,
      );
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}" stroke="${BRIGHT.ink}" stroke-width="2"/>`,
      );
      if (hasSub && node.sublabel) {
        const subSize = fontSize * 0.75;
        const sub = truncate(node.sublabel, Math.max(4, Math.floor((w - pad * 2) / (subSize * 0.55))));
        parts.push(
          `<text x="${x + pad}" y="${y + h / 2 - 2}" font-family="Geist, Helvetica Neue, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="${ink.primary}">${escapeXml(label)}</text>`,
        );
        parts.push(
          `<text x="${x + pad}" y="${y + h / 2 + subSize}" font-family="Geist, Helvetica Neue, Arial, sans-serif" font-size="${subSize}" font-weight="500" fill="${ink.secondary}">${escapeXml(sub)}</text>`,
        );
      } else {
        parts.push(
          `<text x="${x + w / 2}" y="${y + h / 2 + fontSize * 0.35}" text-anchor="middle" font-family="Geist, Helvetica Neue, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="${ink.primary}">${escapeXml(label)}</text>`,
        );
      }
      parts.push(`</g>`);
    } else if (isNumberNode(node)) {
      const rect = matrixToPercents(node.matrix);
      const sizePct = numberBadgeSize(node);
      const w = px(sizePct);
      const cx = px(rect.left) + w / 2;
      const cy = py(rect.top) + w / 2;
      const fill = fillFor(node.colorTheme);
      const ink = textOn(node.colorTheme);
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${w / 2}" fill="${fill}" stroke="${BRIGHT.ink}" stroke-width="2"/>`,
      );
      parts.push(
        `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="Geist, Helvetica Neue, Arial, sans-serif" font-size="14" font-weight="700" fill="${ink.primary}">${escapeXml(String(node.value))}</text>`,
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${parts.join("\n")}
</svg>`;
}
