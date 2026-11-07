import { mkdirSync } from "node:fs";
import type { ReelConfig } from "../config.js";
import type { Logger } from "../logging.js";
import { writeCardStates, type ExcalidrawElement } from "./excalidraw.js";
import { hasError, type DiagramIssue } from "./issues.js";
import { layoutSkeleton } from "./layout.js";
import { reelPaths } from "./paths.js";
import { rel, writeStatus, type StatusCard, type StatusReport } from "./report.js";
import { chromeAvailable, chromeIssue, renderSteps } from "./render.js";
import { loadSkeletonFile, loadWordsFile, validateSkeleton } from "./validate.js";

export type PipelineResult = {
  ok: boolean;
  reelId: string;
  issues: DiagramIssue[];
  statusPath: string | null;
  status?: StatusReport;
  envError: boolean;
};

export async function runValidate(
  config: ReelConfig,
  reelArg: string,
  log: Logger,
): Promise<PipelineResult> {
  const paths = reelPaths(config.diagram.diagramsDir, reelArg);
  const loaded = loadSkeletonFile(paths.skeleton);
  if (!loaded.raw) {
    log.error(loaded.issues[0]?.message ?? "missing skeleton");
    return { ok: false, reelId: paths.reelId, issues: loaded.issues, statusPath: null, envError: false };
  }
  const words = loadWordsFile(paths.words);
  const validated = validateSkeleton(loaded.raw, words.words);
  const issues = [...loaded.issues, ...words.issues, ...validated.issues];
  const ok = !hasError(issues);
  log.info(`validate ${paths.reelArg} ${ok ? "ok" : "failed"}`, { issues: issues.length });
  return { ok, reelId: validated.skeleton?.reelId ?? paths.reelId, issues, statusPath: null, envError: false };
}

export async function runBuild(
  config: ReelConfig,
  reelArg: string,
  log: Logger,
): Promise<PipelineResult> {
  const paths = reelPaths(config.diagram.diagramsDir, reelArg);
  const loaded = loadSkeletonFile(paths.skeleton);
  if (!loaded.raw) {
    log.error(loaded.issues[0]?.message ?? "missing skeleton");
    return { ok: false, reelId: paths.reelId, issues: loaded.issues, statusPath: null, envError: false };
  }
  const words = loadWordsFile(paths.words);
  const validated = validateSkeleton(loaded.raw, words.words);
  const issues: DiagramIssue[] = [...loaded.issues, ...words.issues, ...validated.issues];
  if (!validated.skeleton) {
    const status = writeStatus(paths, { reelId: paths.reelId, cards: [], issues });
    return { ok: false, reelId: paths.reelId, issues, statusPath: paths.status, status, envError: false };
  }
  const skeleton = validated.skeleton;
  mkdirSync(paths.states, { recursive: true });
  mkdirSync(paths.review, { recursive: true });
  log.info(`layout ${skeleton.reelId}`);
  const laid = await layoutSkeleton(skeleton.cards);
  issues.push(...laid.issues);

  const cards: StatusCard[] = [];
  const renderQueue: { cardId: string; step: number; elements: ExcalidrawElement[] }[] = [];
  for (const card of skeleton.cards) {
    const layout = laid.layouts.find((item) => item.cardId === card.id);
    if (!layout) continue;
    const written = await writeCardStates(paths, card, layout);
    const statusSteps = written.steps.map((step) => ({
      step: step.step,
      at: step.at,
      excalidraw: rel(step.filePath) ?? step.filePath,
      png: null as string | null,
    }));
    for (const step of written.steps) {
      renderQueue.push({ cardId: card.id, step: step.step, elements: step.elements });
    }
    cards.push({ id: card.id, steps: statusSteps });
  }

  if (!chromeAvailable(config.diagram.chromePath)) {
    const chrome = chromeIssue(config.diagram.chromePath);
    issues.push(chrome);
    const status = writeStatus(paths, { reelId: skeleton.reelId, cards, issues });
    log.error(chrome.message);
    return { ok: false, reelId: skeleton.reelId, issues, statusPath: paths.status, status, envError: true };
  }

  log.info(`render ${renderQueue.length} steps`);
  const rendered = await renderSteps(config, paths, renderQueue);
  issues.push(...rendered.issues);
  for (const item of rendered.rendered) {
    const card = cards.find((c) => c.id === item.cardId);
    const step = card?.steps.find((s) => s.step === item.step);
    if (step) step.png = rel(item.pngPath);
  }
  const status = writeStatus(paths, { reelId: skeleton.reelId, cards, issues });
  log.info(`wrote ${paths.status} round=${status.round} ok=${status.ok}`);
  return {
    ok: status.ok,
    reelId: skeleton.reelId,
    issues,
    statusPath: paths.status,
    status,
    envError: issues.some((item) => item.code === "CHROME_NOT_FOUND"),
  };
}
