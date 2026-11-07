import { diagramPngUrl } from "@/lib/api/reel-client";
import type { DiagramNode } from "@/types/canvas";

export const DIAGRAM_HOLD_S = 2;

export type DiagramMetaStep = {
  step: number;
  at: number;
};

export type DiagramMetaCard = {
  id: string;
  caption: string;
  steps: DiagramMetaStep[];
};

export type DiagramIssueSummary = {
  code?: string;
  severity?: string;
  message: string;
};

export type DiagramMeta = {
  reelArg: string;
  title: string;
  cards: DiagramMetaCard[];
  status: {
    ok: boolean;
    builtAt: string | null;
    issues: DiagramIssueSummary[];
  } | null;
};

export function padStep(step: number): string {
  return String(step).padStart(2, "0");
}

export function formatDiagramCaption(caption: string): string {
  const trimmed = caption.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith(">") ? trimmed : `> ${trimmed}`;
}

export function diagramBuildHint(reelArg: string): string {
  return `Build this reel first: \`cd src/reel-backend && npm run diagram -- build ${reelArg}\``;
}

export function diagramStepsToElements(
  meta: DiagramMeta,
  audioDuration: number | null,
): DiagramNode[] {
  const flat: Array<{
    cardId: string;
    caption: string;
    step: number;
    at: number;
    track: number;
  }> = [];
  meta.cards.forEach((card, track) => {
    for (const step of card.steps) {
      flat.push({
        cardId: card.id,
        caption: card.caption ?? "",
        step: step.step,
        at: step.at,
        track,
      });
    }
  });
  const lastAt = flat[flat.length - 1]?.at ?? 0;
  const tail = Math.max(audioDuration ?? 0, lastAt + DIAGRAM_HOLD_S);
  return flat.map((item, index) => {
    const next = flat[index + 1];
    return {
      id: `${item.cardId}-step-${padStep(item.step)}`,
      type: "diagram" as const,
      cardId: item.cardId,
      step: item.step,
      at: item.at,
      title: meta.title,
      caption: item.caption,
      pngUrl: diagramPngUrl(meta.reelArg, item.cardId, item.step),
      time: {
        start: item.at,
        end: next ? next.at : tail,
        track: item.track,
      },
    };
  });
}

export function visibleDiagramStep(
  elements: DiagramNode[],
  time: number,
): DiagramNode | null {
  let current: DiagramNode | null = null;
  for (const element of elements) {
    if (element.at <= time) {
      current = element;
    }
  }
  return current;
}

export function diagramReelIdFromDraft(draft: unknown): string | null {
  if (!draft || typeof draft !== "object") {
    return null;
  }
  const value = draft as { version?: unknown; reelId?: unknown };
  if (value.version === 2 && typeof value.reelId === "string" && value.reelId.trim()) {
    return value.reelId.trim();
  }
  return null;
}
