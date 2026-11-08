export type Actor = "algorithm" | "grok" | "human";
export type ClipStatus = "selected" | "rejected" | "undecided";
export type ClipLabel =
  | "falseStart"
  | "cut_off"
  | "starts_late"
  | "missing_words"
  | "misstatement"
  | "none";

export type Word = { text: string; start: number; end: number };
export type SourceRange = { sourceStart: number; sourceEnd: number };

export type Clip = {
  id: string;
  parentIds: string[];
  sourceStart: number;
  sourceEnd: number;
  ranges: SourceRange[];
  duration: number;
  text: string;
  words: Word[];
  groupId: string;
  label: ClipLabel;
  score: number;
  reasons: string[];
  status: ClipStatus;
  decidedBy: Actor;
  statusReason: string;
  statusAt: string;
  note: string;
  llm: Record<string, unknown>;
  silenceBefore: number;
  silenceAfter: number;
  script?: { line: number; text: string; score: number };
};

export type Group = {
  id: string;
  label: string;
  clipIds: string[];
  recommendedClipId: string | null;
  scriptLine?: number;
};

export type CanvasDraft = { version: 1; elements: unknown[] } | { version: 2; reelId: string };

export type Cuts = {
  revision: number;
  clips: Clip[];
  groups: Group[];
  order: string[];
  canvasDraft: CanvasDraft;
};

export function normalizeCanvasDraft(value: unknown): CanvasDraft {
  if (value && typeof value === "object" && (value as { version?: unknown }).version === 2) {
    const reelId = (value as { reelId?: unknown }).reelId;
    if (typeof reelId === "string") {
      return { version: 2, reelId };
    }
  }
  if (value && typeof value === "object" && Array.isArray((value as { elements?: unknown }).elements)) {
    return { version: 1, elements: (value as { elements: unknown[] }).elements };
  }
  return { version: 1, elements: [] };
}

export type IdState = { nextClipSeq: number; nextGroupSeq: number };

export type FieldError = {
  clipId: string | null;
  field: string;
  message: string;
  allowed?: unknown;
};

export class OpError extends Error {
  readonly status = 400;
  readonly errors: FieldError[];

  constructor(errors: FieldError[]) {
    super(errors[0]?.message ?? "Invalid operation");
    this.name = "OpError";
    this.errors = errors;
  }
}

export class ConflictError extends Error {
  readonly status = 409;
  readonly currentRevision: number;

  constructor(currentRevision: number, baseRevision: number) {
    super(`baseRevision ${baseRevision} does not match current ${currentRevision}`);
    this.name = "ConflictError";
    this.currentRevision = currentRevision;
  }
}

export class BusyError extends Error {
  readonly status = 409;
  readonly error = "busy" as const;
  readonly code: string;

  constructor(message = "Analysis is already running", code = "busy") {
    super(message);
    this.name = "BusyError";
    this.code = code;
  }
}

export class NotFoundError extends Error {
  readonly status = 404;

  constructor(message = "not_found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class NameConflictError extends Error {
  readonly status = 409;

  constructor(name: string) {
    super(`A project named "${name}" already exists`);
    this.name = "NameConflictError";
  }
}

export class InvalidSlugError extends Error {
  readonly status = 400;

  constructor(message = "Invalid project slug") {
    super(message);
    this.name = "InvalidSlugError";
  }
}

export function throwIfBusy(status: string): void {
  if (status === "analyzing") throw new BusyError("Analysis is already running", "analysis_running");
  if (status === "rendering") throw new BusyError("Project is rendering", "render_running");
}

export const LLM_MAX_BYTES = 8 * 1024;

export function emptyLlm(): Record<string, unknown> {
  return {};
}

export function normalizeClip(clip: Clip): Clip {
  return {
    ...clip,
    statusReason: typeof clip.statusReason === "string" ? clip.statusReason : "",
    statusAt: typeof clip.statusAt === "string" ? clip.statusAt : "",
    note: typeof clip.note === "string" ? clip.note : "",
    llm: clip.llm && typeof clip.llm === "object" && !Array.isArray(clip.llm) ? clip.llm : {},
    script:
      clip.script && typeof clip.script === "object"
        ? {
            line: Number(clip.script.line) || 0,
            text: typeof clip.script.text === "string" ? clip.script.text : "",
            score: Number(clip.script.score) || 0,
          }
        : clip.script,
    parentIds: Array.isArray(clip.parentIds) ? clip.parentIds : [],
    ranges: Array.isArray(clip.ranges) ? clip.ranges : [],
    words: Array.isArray(clip.words) ? clip.words : [],
    reasons: Array.isArray(clip.reasons) ? clip.reasons : [],
    silenceBefore: Math.max(0, Number(clip.silenceBefore) || 0),
    silenceAfter: Math.max(0, Number(clip.silenceAfter) || 0),
  };
}

export function normalizeCuts(doc: Cuts): Cuts {
  return {
    ...doc,
    clips: (doc.clips ?? []).map(normalizeClip),
    groups: (doc.groups ?? []).map((group) => ({
      ...group,
      scriptLine: typeof group.scriptLine === "number" ? group.scriptLine : group.scriptLine,
    })),
    order: doc.order ?? [],
    canvasDraft: normalizeCanvasDraft(doc.canvasDraft),
  };
}

export function emptyCuts(): Cuts {
  return {
    revision: 0,
    clips: [],
    groups: [],
    order: [],
    canvasDraft: { version: 1, elements: [] },
  };
}

export function formatClipId(seq: number): string {
  return `c-${String(seq).padStart(4, "0")}`;
}

export function formatGroupId(seq: number): string {
  return `g-${String(seq).padStart(4, "0")}`;
}

export function mintClipId(ids: IdState): string {
  const id = formatClipId(ids.nextClipSeq);
  ids.nextClipSeq += 1;
  return id;
}

export function mintGroupId(ids: IdState): string {
  const id = formatGroupId(ids.nextGroupSeq);
  ids.nextGroupSeq += 1;
  return id;
}

export function playRanges(clip: Pick<Clip, "ranges" | "sourceStart" | "sourceEnd">): SourceRange[] {
  if (clip.ranges.length > 0) return clip.ranges;
  return [{ sourceStart: clip.sourceStart, sourceEnd: clip.sourceEnd }];
}

export function rangeDuration(ranges: SourceRange[]): number {
  return ranges.reduce((sum, range) => sum + Math.max(0, range.sourceEnd - range.sourceStart), 0);
}

export function clipPlayDuration(clip: Pick<Clip, "ranges" | "sourceStart" | "sourceEnd" | "silenceBefore" | "silenceAfter">): number {
  return rangeDuration(playRanges(clip)) + Math.max(0, clip.silenceBefore ?? 0) + Math.max(0, clip.silenceAfter ?? 0);
}

export function textFromWords(words: Word[]): string {
  return words
    .map((word) => word.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function clipById(doc: Cuts, id: string): Clip {
  const clip = doc.clips.find((item) => item.id === id);
  if (!clip) {
    throw new OpError([
      {
        clipId: id,
        field: "id",
        message: `Unknown clip ${id}`,
        allowed: doc.clips.map((item) => item.id),
      },
    ]);
  }
  return clip;
}

export function iou(a: SourceRange, b: SourceRange): number {
  const start = Math.max(a.sourceStart, b.sourceStart);
  const end = Math.min(a.sourceEnd, b.sourceEnd);
  const inter = Math.max(0, end - start);
  const union = a.sourceEnd - a.sourceStart + (b.sourceEnd - b.sourceStart) - inter;
  if (union <= 0) return 0;
  return inter / union;
}

export function overlaps(a: SourceRange, b: SourceRange): boolean {
  return a.sourceEnd > b.sourceStart && a.sourceStart < b.sourceEnd;
}
