import { z } from "zod";
import {
  ANNOTATION_MAX,
  BADGE_TEXT_MAX,
  CAPTION_MAX,
  NODE_LABEL_MAX,
} from "./tokens.js";

const kebabId = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id must be kebab-case");

const FORBIDDEN_LAYOUT_KEYS = ["x", "y", "width", "height"] as const;

function rejectLayoutKeys(value: unknown, ctx: z.RefinementCtx) {
  if (!value || typeof value !== "object") return;
  for (const key of FORBIDDEN_LAYOUT_KEYS) {
    if (key in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden layout key "${key}". Positions are assigned by the layout engine.`,
      });
    }
  }
}

export const SHAPES = ["rect", "rounded", "diamond", "ellipse", "pill"] as const;
export const TONES = ["blue", "red", "green", "ink"] as const;
export const EDGE_STYLES = ["solid", "dashed"] as const;
export const PLACEMENTS = ["above", "below", "left", "right"] as const;
export const MARK_KINDS = ["x", "check"] as const;
export const DIRECTIONS = ["down", "right"] as const;

export const nodeSchema = z
  .object({
    id: kebabId,
    shape: z.enum(SHAPES),
    label: z.string().min(1),
    tone: z.enum(TONES).default("blue"),
    step: z.number().int().min(1),
  })
  .strict()
  .superRefine(rejectLayoutKeys);

export const edgeSchema = z
  .object({
    id: kebabId,
    from: kebabId,
    to: kebabId,
    style: z.enum(EDGE_STYLES).default("solid"),
    label: z.string().nullable().optional(),
    step: z.number().int().min(1),
  })
  .strict()
  .superRefine(rejectLayoutKeys);

export const badgeSchema = z
  .object({
    id: kebabId,
    text: z.string().min(1),
    attachTo: kebabId,
    placement: z.enum(PLACEMENTS).default("below"),
    step: z.number().int().min(1),
  })
  .strict()
  .superRefine(rejectLayoutKeys);

export const annotationSchema = z
  .object({
    id: kebabId,
    text: z.string().min(1),
    attachTo: kebabId,
    placement: z.enum(PLACEMENTS).default("right"),
    step: z.number().int().min(1),
  })
  .strict()
  .superRefine(rejectLayoutKeys);

export const markSchema = z
  .object({
    id: kebabId,
    kind: z.enum(MARK_KINDS),
    attachTo: kebabId,
    step: z.number().int().min(1),
  })
  .strict()
  .superRefine(rejectLayoutKeys);

export const stepSchema = z
  .object({
    step: z.number().int().min(1),
    at: z.number().finite(),
  })
  .strict();

export const cardSchema = z
  .object({
    id: kebabId,
    caption: z.string().optional(),
    direction: z.enum(DIRECTIONS).default("down"),
    nodes: z.array(nodeSchema).min(1),
    edges: z.array(edgeSchema).default([]),
    badges: z.array(badgeSchema).default([]),
    annotations: z.array(annotationSchema).default([]),
    marks: z.array(markSchema).default([]),
    steps: z.array(stepSchema).min(1),
  })
  .strict();

export const skeletonSchema = z
  .object({
    version: z.literal(1),
    reelId: kebabId,
    title: z.string().min(1),
    cards: z.array(cardSchema).min(1),
  })
  .strict();

export const wordsSchema = z.array(
  z
    .object({
      word: z.string().min(1),
      start: z.number().finite(),
      end: z.number().finite(),
    })
    .strict(),
);

export type DiagramNode = z.infer<typeof nodeSchema>;
export type DiagramEdge = z.infer<typeof edgeSchema>;
export type DiagramBadge = z.infer<typeof badgeSchema>;
export type DiagramAnnotation = z.infer<typeof annotationSchema>;
export type DiagramMark = z.infer<typeof markSchema>;
export type DiagramCard = z.infer<typeof cardSchema>;
export type DiagramSkeleton = z.infer<typeof skeletonSchema>;
export type ScriptWord = z.infer<typeof wordsSchema>[number];

export const TEXT_LIMITS = {
  node: NODE_LABEL_MAX,
  badge: BADGE_TEXT_MAX,
  annotation: ANNOTATION_MAX,
  caption: CAPTION_MAX,
} as const;
