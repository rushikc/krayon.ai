import { existsSync, readFileSync } from "node:fs";
import { issue, type DiagramIssue } from "./issues.js";
import { TEXT_LIMITS, skeletonSchema, wordsSchema, type DiagramCard, type DiagramSkeleton, type ScriptWord } from "./skeleton.js";
import { DENSITY_ERROR, DENSITY_WARN, WORD_SNAP_S } from "./tokens.js";

export type ValidateResult = {
  skeleton?: DiagramSkeleton;
  issues: DiagramIssue[];
};

function zodIssues(error: { issues: { path: (string | number)[]; message: string }[] }): DiagramIssue[] {
  return error.issues.map((item) =>
    issue("SCHEMA_INVALID", "error", `${item.path.join(".") || "(root)"}: ${item.message}`),
  );
}

function textLen(value: string): number {
  return [...value].length;
}

function collectIds(card: DiagramCard): Map<string, string> {
  const map = new Map<string, string>();
  const add = (id: string, kind: string) => {
    if (!map.has(id)) map.set(id, kind);
  };
  for (const node of card.nodes) add(node.id, "node");
  for (const edge of card.edges) add(edge.id, "edge");
  for (const badge of card.badges) add(badge.id, "badge");
  for (const annotation of card.annotations) add(annotation.id, "annotation");
  for (const mark of card.marks) add(mark.id, "mark");
  return map;
}

function uniqueIdIssues(card: DiagramCard): DiagramIssue[] {
  const seen = new Map<string, string>();
  const issues: DiagramIssue[] = [];
  const add = (id: string, kind: string) => {
    const prev = seen.get(id);
    if (prev) {
      issues.push(
        issue("DUPLICATE_ID", "error", `Duplicate id "${id}" used by ${prev} and ${kind}`, {
          cardId: card.id,
          elementId: id,
        }),
      );
    } else {
      seen.set(id, kind);
    }
  };
  for (const node of card.nodes) add(node.id, "node");
  for (const edge of card.edges) add(edge.id, "edge");
  for (const badge of card.badges) add(badge.id, "badge");
  for (const annotation of card.annotations) add(annotation.id, "annotation");
  for (const mark of card.marks) add(mark.id, "mark");
  return issues;
}

function stepIssues(card: DiagramCard): DiagramIssue[] {
  const issues: DiagramIssue[] = [];
  const steps = [...card.steps].sort((a, b) => a.step - b.step);
  const ids = new Set<number>();
  for (let index = 0; index < steps.length; index += 1) {
    const current = steps[index]!;
    if (ids.has(current.step)) {
      issues.push(
        issue("STEPS_NOT_CONTIGUOUS", "error", `Duplicate step number ${current.step}`, {
          cardId: card.id,
          step: current.step,
        }),
      );
    }
    ids.add(current.step);
    if (current.step !== index + 1) {
      issues.push(
        issue("STEPS_NOT_CONTIGUOUS", "error", `Steps must be contiguous from 1 (found ${current.step} at index ${index})`, {
          cardId: card.id,
          step: current.step,
        }),
      );
    }
    const prev = steps[index - 1];
    if (prev && current.at <= prev.at) {
      issues.push(
        issue("STEPS_NOT_INCREASING", "error", `steps[].at must be strictly increasing (${prev.at} then ${current.at})`, {
          cardId: card.id,
          step: current.step,
        }),
      );
    }
  }
  return issues;
}

function elementStepIssues(card: DiagramCard): DiagramIssue[] {
  const known = new Set(card.steps.map((item) => item.step));
  const issues: DiagramIssue[] = [];
  const check = (id: string, step: number) => {
    if (!known.has(step)) {
      issues.push(
        issue("INVALID_STEP", "error", `Element "${id}" uses step ${step} which is not in steps[]`, {
          cardId: card.id,
          step,
          elementId: id,
        }),
      );
    }
  };
  for (const node of card.nodes) check(node.id, node.step);
  for (const edge of card.edges) check(edge.id, edge.step);
  for (const badge of card.badges) check(badge.id, badge.step);
  for (const annotation of card.annotations) check(annotation.id, annotation.step);
  for (const mark of card.marks) check(mark.id, mark.step);
  return issues;
}

function refIssues(card: DiagramCard): DiagramIssue[] {
  const kinds = collectIds(card);
  const issues: DiagramIssue[] = [];
  const resolve = (id: string, elementId: string, field: string) => {
    if (!kinds.has(id)) {
      issues.push(
        issue("UNKNOWN_REF", "error", `${field} "${id}" does not exist on this card`, {
          cardId: card.id,
          elementId,
        }),
      );
      return undefined;
    }
    return kinds.get(id);
  };
  for (const edge of card.edges) {
    const fromKind = resolve(edge.from, edge.id, "from");
    const toKind = resolve(edge.to, edge.id, "to");
    if (fromKind && fromKind !== "node") {
      issues.push(
        issue("EDGE_ENDPOINT_NOT_NODE", "error", `Edge "${edge.id}" from "${edge.from}" is not a node`, {
          cardId: card.id,
          elementId: edge.id,
        }),
      );
    }
    if (toKind && toKind !== "node") {
      issues.push(
        issue("EDGE_ENDPOINT_NOT_NODE", "error", `Edge "${edge.id}" to "${edge.to}" is not a node`, {
          cardId: card.id,
          elementId: edge.id,
        }),
      );
    }
  }
  const attachable = (kind: string | undefined) => kind === "node" || kind === "edge";
  for (const badge of card.badges) {
    const kind = resolve(badge.attachTo, badge.id, "attachTo");
    if (kind && !attachable(kind)) {
      issues.push(
        issue("UNKNOWN_REF", "error", `Badge "${badge.id}" cannot attach to ${kind} "${badge.attachTo}"`, {
          cardId: card.id,
          elementId: badge.id,
        }),
      );
    }
  }
  for (const annotation of card.annotations) {
    const kind = resolve(annotation.attachTo, annotation.id, "attachTo");
    if (kind && !attachable(kind)) {
      issues.push(
        issue("UNKNOWN_REF", "error", `Annotation "${annotation.id}" cannot attach to ${kind} "${annotation.attachTo}"`, {
          cardId: card.id,
          elementId: annotation.id,
        }),
      );
    }
  }
  for (const mark of card.marks) {
    const kind = resolve(mark.attachTo, mark.id, "attachTo");
    if (kind && !attachable(kind)) {
      issues.push(
        issue("UNKNOWN_REF", "error", `Mark "${mark.id}" cannot attach to ${kind} "${mark.attachTo}"`, {
          cardId: card.id,
          elementId: mark.id,
        }),
      );
    }
  }
  return issues;
}

function textIssues(card: DiagramCard): DiagramIssue[] {
  const issues: DiagramIssue[] = [];
  if (card.caption && textLen(card.caption) > TEXT_LIMITS.caption) {
    issues.push(
      issue("TEXT_TOO_LONG", "error", `Caption exceeds ${TEXT_LIMITS.caption} characters`, {
        cardId: card.id,
      }),
    );
  }
  for (const node of card.nodes) {
    if (textLen(node.label) > TEXT_LIMITS.node) {
      issues.push(
        issue("TEXT_TOO_LONG", "error", `Node label exceeds ${TEXT_LIMITS.node} characters`, {
          cardId: card.id,
          elementId: node.id,
          step: node.step,
        }),
      );
    }
  }
  for (const badge of card.badges) {
    if (textLen(badge.text) > TEXT_LIMITS.badge) {
      issues.push(
        issue("TEXT_TOO_LONG", "error", `Badge text exceeds ${TEXT_LIMITS.badge} characters`, {
          cardId: card.id,
          elementId: badge.id,
          step: badge.step,
        }),
      );
    }
  }
  for (const annotation of card.annotations) {
    if (textLen(annotation.text) > TEXT_LIMITS.annotation) {
      issues.push(
        issue("TEXT_TOO_LONG", "error", `Annotation exceeds ${TEXT_LIMITS.annotation} characters`, {
          cardId: card.id,
          elementId: annotation.id,
          step: annotation.step,
        }),
      );
    }
  }
  for (const edge of card.edges) {
    if (edge.label && textLen(edge.label) > TEXT_LIMITS.node) {
      issues.push(
        issue("TEXT_TOO_LONG", "error", `Edge label exceeds ${TEXT_LIMITS.node} characters`, {
          cardId: card.id,
          elementId: edge.id,
          step: edge.step,
        }),
      );
    }
  }
  return issues;
}

export function densityAtStep(card: DiagramCard, step: number): number {
  let count = 0;
  for (const node of card.nodes) if (node.step <= step) count += 1;
  for (const badge of card.badges) if (badge.step <= step) count += 1;
  for (const annotation of card.annotations) if (annotation.step <= step) count += 1;
  return count;
}

function densityIssues(card: DiagramCard): DiagramIssue[] {
  const issues: DiagramIssue[] = [];
  const maxStep = Math.max(...card.steps.map((item) => item.step));
  for (let step = 1; step <= maxStep; step += 1) {
    const count = densityAtStep(card, step);
    if (count > DENSITY_ERROR) {
      issues.push(
        issue(
          "DENSITY",
          "error",
          `Step ${step} shows ${count} nodes+badges+annotations (max ${DENSITY_ERROR}); start a new card`,
          { cardId: card.id, step },
        ),
      );
    } else if (count > DENSITY_WARN) {
      issues.push(
        issue(
          "DENSITY",
          "warning",
          `Step ${step} shows ${count} nodes+badges+annotations (prefer <= ${DENSITY_WARN})`,
          { cardId: card.id, step },
        ),
      );
    }
  }
  return issues;
}

function wordIssues(card: DiagramCard, words: ScriptWord[]): DiagramIssue[] {
  const issues: DiagramIssue[] = [];
  for (const step of card.steps) {
    const near = words.some((word) => Math.abs(word.start - step.at) <= WORD_SNAP_S);
    if (!near) {
      issues.push(
        issue(
          "STEP_NOT_ON_WORD",
          "warning",
          `Step ${step.step} at=${step.at}s is not within ${WORD_SNAP_S}s of a word start`,
          { cardId: card.id, step: step.step },
        ),
      );
    }
  }
  return issues;
}

export function validateCard(card: DiagramCard, words?: ScriptWord[]): DiagramIssue[] {
  const issues = [
    ...uniqueIdIssues(card),
    ...stepIssues(card),
    ...elementStepIssues(card),
    ...refIssues(card),
    ...textIssues(card),
    ...densityIssues(card),
  ];
  if (words) issues.push(...wordIssues(card, words));
  return issues;
}

export function validateSkeleton(raw: unknown, words?: ScriptWord[]): ValidateResult {
  const parsed = skeletonSchema.safeParse(raw);
  if (!parsed.success) {
    return { issues: zodIssues(parsed.error) };
  }
  const skeleton = parsed.data;
  const issues: DiagramIssue[] = [];
  const cardIds = new Set<string>();
  for (const card of skeleton.cards) {
    if (cardIds.has(card.id)) {
      issues.push(issue("DUPLICATE_ID", "error", `Duplicate card id "${card.id}"`, { cardId: card.id }));
    }
    cardIds.add(card.id);
    issues.push(...validateCard(card, words));
  }
  return { skeleton, issues };
}

export function loadWordsFile(filePath: string): { words?: ScriptWord[]; issues: DiagramIssue[] } {
  if (!existsSync(filePath)) return { issues: [] };
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    const parsed = wordsSchema.safeParse(raw);
    if (!parsed.success) return { issues: zodIssues(parsed.error) };
    return { words: parsed.data, issues: [] };
  } catch (error) {
    return {
      issues: [
        issue("SCHEMA_INVALID", "error", `script.words.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`),
      ],
    };
  }
}

export function loadSkeletonFile(filePath: string): { raw?: unknown; issues: DiagramIssue[] } {
  if (!existsSync(filePath)) {
    return { issues: [issue("REEL_NOT_FOUND", "error", `Missing diagram.skeleton.json at ${filePath}`)] };
  }
  try {
    return { raw: JSON.parse(readFileSync(filePath, "utf8")) as unknown, issues: [] };
  } catch (error) {
    return {
      issues: [
        issue(
          "SCHEMA_INVALID",
          "error",
          `diagram.skeleton.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    };
  }
}
