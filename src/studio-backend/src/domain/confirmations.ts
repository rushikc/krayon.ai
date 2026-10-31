import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { applyOps, type Op } from "./ops.js";
import { OpError, type Actor, type Cuts, type IdState } from "./types.js";

export const confirmationKindSchema = z.enum(["confirm", "choice"]);
export const confirmationStatusSchema = z.enum(["pending", "answered", "expired", "cancelled", "stale"]);

export const confirmationOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  style: z.enum(["primary", "danger", "default"]).optional(),
  applyOps: z.boolean().optional(),
});

export const proposedOpsSchema = z.object({
  baseRevision: z.number().int(),
  ops: z.array(z.custom<Op>((value) => Boolean(value && typeof value === "object" && "op" in value))).min(1),
});

export const createConfirmationSchema = z.object({
  kind: confirmationKindSchema,
  title: z.string().min(1),
  message: z.string().default(""),
  clipIds: z.array(z.string()).default([]),
  options: z.array(confirmationOptionSchema).min(1),
  defaultOptionId: z.string().nullable().optional(),
  proposedOps: proposedOpsSchema.nullable().optional(),
  allowNote: z.boolean().optional(),
  expiresAt: z.string().nullable().optional(),
  callbackUrl: z.string().nullable().optional(),
});

export type ConfirmationOption = z.infer<typeof confirmationOptionSchema>;
export type ProposedOps = z.infer<typeof proposedOpsSchema>;
export type CreateConfirmation = z.infer<typeof createConfirmationSchema>;

export type ConfirmationAnswer = {
  optionId: string;
  note: string;
  by: Actor;
  at: string;
};

export type ConfirmationResult = {
  applied: boolean;
  revision: number | null;
  error: string | null;
};

export type ConfirmationItem = {
  id: string;
  seq: number;
  kind: "confirm" | "choice";
  title: string;
  message: string;
  clipIds: string[];
  options: ConfirmationOption[];
  defaultOptionId: string | null;
  proposedOps: ProposedOps | null;
  allowNote: boolean;
  status: z.infer<typeof confirmationStatusSchema>;
  answer: ConfirmationAnswer | null;
  result: ConfirmationResult | null;
  createdBy: Actor;
  createdAt: string;
  expiresAt: string | null;
  callbackUrl: string | null;
};

export type ConfirmationsFile = {
  version: 1;
  nextSeq: number;
  items: ConfirmationItem[];
};

export function emptyConfirmations(): ConfirmationsFile {
  return { version: 1, nextSeq: 1, items: [] };
}

export function formatQuestionId(seq: number): string {
  return `q-${String(seq).padStart(4, "0")}`;
}

export function confirmationsPath(dir: string): string {
  return path.join(dir, "confirmations.json");
}

export async function readConfirmations(dir: string): Promise<ConfirmationsFile> {
  try {
    return JSON.parse(await readFile(confirmationsPath(dir), "utf8")) as ConfirmationsFile;
  } catch {
    return emptyConfirmations();
  }
}

export async function writeConfirmations(dir: string, file: ConfirmationsFile): Promise<void> {
  const dest = confirmationsPath(dir);
  const tmp = `${dest}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2));
  await rename(tmp, dest);
}

export function assertCallbackUrl(url: string | null | undefined): void {
  if (!url) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OpError([{ clipId: null, field: "callbackUrl", message: "callbackUrl must be a valid URL" }]);
  }
  if (parsed.protocol !== "http:") {
    throw new OpError([{ clipId: null, field: "callbackUrl", message: "callbackUrl must be http://127.0.0.1 or http://localhost" }]);
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new OpError([{ clipId: null, field: "callbackUrl", message: "callbackUrl host must be 127.0.0.1 or localhost" }]);
  }
}

export function validateConfirmationInput(
  input: unknown,
  cuts: Cuts,
  ids: IdState,
): CreateConfirmation {
  const parsed = createConfirmationSchema.parse(input);
  const optionIds = parsed.options.map((option) => option.id);
  if (new Set(optionIds).size !== optionIds.length) {
    throw new OpError([{ clipId: null, field: "options", message: "option ids must be unique" }]);
  }
  if (parsed.kind === "choice" && (parsed.options.length < 2 || parsed.options.length > 6)) {
    throw new OpError([{ clipId: null, field: "options", message: "choice needs 2 to 6 options", allowed: { min: 2, max: 6 } }]);
  }
  if (parsed.defaultOptionId && !optionIds.includes(parsed.defaultOptionId)) {
    throw new OpError([{ clipId: null, field: "defaultOptionId", message: "defaultOptionId must match an option" }]);
  }
  for (const clipId of parsed.clipIds) {
    if (!cuts.clips.some((clip) => clip.id === clipId)) {
      throw new OpError([{ clipId, field: "clipIds", message: `Unknown clip ${clipId}`, allowed: cuts.clips.map((clip) => clip.id) }]);
    }
  }
  assertCallbackUrl(parsed.callbackUrl);
  if (parsed.proposedOps) {
    applyOps(cuts, { nextClipSeq: ids.nextClipSeq, nextGroupSeq: ids.nextGroupSeq }, parsed.proposedOps.ops, "grok");
  }
  return parsed;
}

export function mintConfirmation(
  file: ConfirmationsFile,
  input: CreateConfirmation,
  createdBy: Actor,
): ConfirmationItem {
  const seq = file.nextSeq;
  file.nextSeq += 1;
  const item: ConfirmationItem = {
    id: formatQuestionId(seq),
    seq,
    kind: input.kind,
    title: input.title,
    message: input.message,
    clipIds: input.clipIds,
    options: input.options,
    defaultOptionId: input.defaultOptionId ?? null,
    proposedOps: input.proposedOps ?? null,
    allowNote: Boolean(input.allowNote),
    status: "pending",
    answer: null,
    result: null,
    createdBy,
    createdAt: new Date().toISOString(),
    expiresAt: input.expiresAt ?? null,
    callbackUrl: input.callbackUrl ?? null,
  };
  file.items.push(item);
  return item;
}

export function describeOpsPreview(ops: Op[] | undefined): string {
  if (!ops?.length) return "";
  return ops
    .map((op) => {
      if (op.op === "select" || op.op === "reject" || op.op === "undecided") return `${op.op} ${op.clipId}`;
      if (op.op === "split") return `split ${op.clipId}`;
      if (op.op === "merge") return `merge ${op.clipIds.join(" ")}`;
      if (op.op === "trim") return `trim ${op.clipId}`;
      if (op.op === "note") return `note ${op.clipId}`;
      return op.op;
    })
    .join(", ");
}
