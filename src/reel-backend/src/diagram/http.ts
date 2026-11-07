import { existsSync, readFileSync } from "node:fs";
import { AppError } from "../errors.js";
import { assertUnderDiagramsRoot, cardPngPath, listReelArgs, safeReelPaths, UnsafeReelPathError } from "./paths.js";

export type DiagramListItem = {
  reelArg: string;
  title: string;
  hasStatus: boolean;
  ok: boolean | null;
  builtAt: string | null;
  stepCount: number;
};

export type DiagramMetaResponse = {
  reelArg: string;
  title: string;
  cards: Array<{
    id: string;
    caption: string;
    steps: Array<{ step: number; at: number }>;
  }>;
  status: {
    ok: boolean;
    builtAt: string | null;
    issues: Array<{ code?: string; severity?: string; message: string }>;
  } | null;
};

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function titleOf(raw: unknown, fallback: string): string {
  if (raw && typeof raw === "object" && "title" in raw && typeof (raw as { title: unknown }).title === "string") {
    return (raw as { title: string }).title;
  }
  return fallback;
}

function publicCards(raw: unknown): DiagramMetaResponse["cards"] {
  if (!raw || typeof raw !== "object" || !("cards" in raw) || !Array.isArray((raw as { cards: unknown }).cards)) {
    return [];
  }
  return (raw as { cards: unknown[] }).cards.flatMap((card) => {
    if (!card || typeof card !== "object") return [];
    const rec = card as { id?: unknown; caption?: unknown; steps?: unknown };
    if (typeof rec.id !== "string") return [];
    const steps = Array.isArray(rec.steps)
      ? rec.steps.flatMap((step) => {
          if (!step || typeof step !== "object") return [];
          const item = step as { step?: unknown; at?: unknown };
          if (typeof item.step !== "number" || typeof item.at !== "number") return [];
          return [{ step: item.step, at: item.at }];
        })
      : [];
    return [
      {
        id: rec.id,
        caption: typeof rec.caption === "string" ? rec.caption : "",
        steps,
      },
    ];
  });
}

function statusSummary(raw: unknown): DiagramMetaResponse["status"] {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as { ok?: unknown; builtAt?: unknown; issues?: unknown };
  const issues = Array.isArray(rec.issues)
    ? rec.issues.flatMap((issue) => {
        if (!issue || typeof issue !== "object") return [];
        const item = issue as { code?: unknown; severity?: unknown; message?: unknown };
        if (typeof item.message !== "string") return [];
        return [
          {
            code: typeof item.code === "string" ? item.code : undefined,
            severity: typeof item.severity === "string" ? item.severity : undefined,
            message: item.message,
          },
        ];
      })
    : [];
  return {
    ok: rec.ok === true,
    builtAt: typeof rec.builtAt === "string" ? rec.builtAt : null,
    issues,
  };
}

export function listDiagramReels(diagramsDir: string): { reels: DiagramListItem[] } {
  const reels = listReelArgs(diagramsDir).map((reelArg) => {
    const paths = safeReelPaths(diagramsDir, reelArg);
    let title = paths.reelId;
    let stepCount = 0;
    try {
      const skeleton = readJson(paths.skeleton);
      title = titleOf(skeleton, title);
      stepCount = publicCards(skeleton).reduce((sum, card) => sum + card.steps.length, 0);
    } catch {
      // list still returns the id
    }
    let hasStatus = false;
    let ok: boolean | null = null;
    let builtAt: string | null = null;
    if (existsSync(paths.status)) {
      hasStatus = true;
      try {
        const status = statusSummary(readJson(paths.status));
        ok = status?.ok ?? false;
        builtAt = status?.builtAt ?? null;
      } catch {
        ok = false;
      }
    }
    return { reelArg, title, hasStatus, ok, builtAt, stepCount };
  });
  return { reels };
}

export function diagramMeta(diagramsDir: string, reelArg: string): DiagramMetaResponse {
  try {
    const paths = safeReelPaths(diagramsDir, reelArg);
    if (!existsSync(paths.skeleton)) {
      throw new AppError("NOT_FOUND", "Reel not found");
    }
    const skeleton = readJson(paths.skeleton);
    const status = existsSync(paths.status) ? statusSummary(readJson(paths.status)) : null;
    return {
      reelArg: paths.reelArg,
      title: titleOf(skeleton, paths.reelId),
      cards: publicCards(skeleton),
      status,
    };
  } catch (error) {
    if (error instanceof UnsafeReelPathError) {
      throw new AppError("BAD_REQUEST", error.message);
    }
    throw error;
  }
}

export function diagramPng(diagramsDir: string, reelArg: string, cardId: string, step: number): string {
  if (!cardId || cardId.includes("..") || cardId.includes("/") || cardId.includes("\\")) {
    throw new AppError("BAD_REQUEST", "Invalid card id");
  }
  if (!Number.isInteger(step) || step < 1) {
    throw new AppError("BAD_REQUEST", "Invalid step");
  }
  try {
    const paths = safeReelPaths(diagramsDir, reelArg);
    const file = assertUnderDiagramsRoot(diagramsDir, cardPngPath(paths, cardId, step));
    if (!existsSync(file)) {
      throw new AppError("NOT_FOUND", "Image not found");
    }
    return file;
  } catch (error) {
    if (error instanceof UnsafeReelPathError) {
      throw new AppError("BAD_REQUEST", error.message);
    }
    throw error;
  }
}
