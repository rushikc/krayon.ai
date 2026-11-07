import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { copyFileSync } from "node:fs";
import { repoRoot } from "../config.js";
import type { DiagramIssue } from "./issues.js";
import { hasError } from "./issues.js";
import { repoRelative, type ReelPaths } from "./paths.js";

export type StatusStep = {
  step: number;
  at: number;
  excalidraw: string;
  png: string | null;
};

export type StatusCard = {
  id: string;
  steps: StatusStep[];
};

export type StatusReport = {
  reelId: string;
  builtAt: string;
  ok: boolean;
  round: number;
  cards: StatusCard[];
  issues: DiagramIssue[];
};

export function writeStatus(
  paths: ReelPaths,
  input: {
    reelId: string;
    cards: StatusCard[];
    issues: DiagramIssue[];
  },
): StatusReport {
  let round = 1;
  if (existsSync(paths.status)) {
    copyFileSync(paths.status, paths.statusPrev);
    try {
      const prev = JSON.parse(readFileSync(paths.status, "utf8")) as { round?: number };
      if (typeof prev.round === "number" && Number.isFinite(prev.round)) round = prev.round + 1;
    } catch {
      round = 2;
    }
  }
  const report: StatusReport = {
    reelId: input.reelId,
    builtAt: new Date().toISOString(),
    ok: !hasError(input.issues),
    round,
    cards: input.cards,
    issues: input.issues,
  };
  writeFileSync(paths.status, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function rel(filePath: string | null): string | null {
  if (!filePath) return null;
  return repoRelative(repoRoot, filePath);
}
