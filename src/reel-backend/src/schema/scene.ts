import { z } from "zod";
import { MATRIX_COLS, MATRIX_ROWS } from "../canvas/geometry.js";
import { COLOR_THEMES, type CanvasElement } from "../canvas/types.js";

const FORBIDDEN_LAYOUT_KEYS = ["x", "y", "width", "height"] as const;

const timeSchema = z
  .object({
    start: z.number().finite(),
    end: z.number().finite(),
    track: z.number().int().min(0).max(9),
  })
  .strict()
  .refine((time) => time.end > time.start, { message: "time.end must be greater than time.start" });

function hasForbiddenKeys(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of FORBIDDEN_LAYOUT_KEYS) {
    if (key in record) {
      return `Forbidden layout key "${key}". Use matrix (and optional size on number).`;
    }
  }
  return null;
}

function inCol(n: number) {
  return n >= 0 && n < MATRIX_COLS;
}

function inRow(n: number) {
  return n >= 0 && n < MATRIX_ROWS;
}

const boxMatrixSchema = z
  .tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()])
  .refine(([x1, y1, x2, y2]) => inCol(x1) && inCol(x2) && inRow(y1) && inRow(y2) && x2 >= x1 && y2 >= y1, {
    message: "box matrix must be integers inside 18×32 with X1≤X2 and Y1≤Y2",
  });

const numberMatrixSchema = z
  .array(z.number().finite())
  .refine((m) => m.length === 2 || m.length === 4, { message: "number matrix must have length 2 or 4" })
  .refine((m) => {
    if (m.length === 2) {
      const [x, y] = m;
      return x != null && y != null && inCol(x) && inRow(y);
    }
    const [x1, y1, x2, y2] = m;
    return (
      x1 != null &&
      y1 != null &&
      x2 != null &&
      y2 != null &&
      inCol(x1) &&
      inCol(x2) &&
      inRow(y1) &&
      inRow(y2) &&
      x2 >= x1 &&
      y2 >= y1
    );
  }, { message: "number matrix must stay inside 18×32 with X1≤X2 and Y1≤Y2" });

const boxSchema = z.object({
  id: z.string().min(1),
  type: z.literal("box"),
  matrix: boxMatrixSchema,
  label: z.string().min(1),
  sublabel: z.string().min(1).optional(),
  fontSize: z.number().finite().min(10).max(48).optional(),
  colorTheme: z.enum(COLOR_THEMES),
  time: timeSchema,
});

const numberSchema = z.object({
  id: z.string().min(1),
  type: z.literal("number"),
  matrix: numberMatrixSchema,
  size: z.number().finite().min(4).max(40).optional(),
  value: z.number().finite(),
  colorTheme: z.enum(COLOR_THEMES),
  time: timeSchema,
});

const arrowSchema = z.object({
  id: z.string().min(1),
  type: z.literal("arrow"),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  variant: z.enum(["solid", "dashed"]).optional(),
  time: timeSchema,
});

export const elementSchema = z.discriminatedUnion("type", [boxSchema, numberSchema, arrowSchema]);

export const sceneSchema = z.array(z.unknown()).superRefine((rawElements, ctx) => {
  rawElements.forEach((raw, i) => {
    const forbidden = hasForbiddenKeys(raw);
    if (forbidden) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: forbidden, path: [i] });
    }
    if (raw && typeof raw === "object" && (raw as { type?: unknown }).type === "arrow") {
      if ("matrix" in raw) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "arrows must not have matrix", path: [i] });
      }
      if ("colorTheme" in raw) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "arrows must not have colorTheme",
          path: [i],
        });
      }
    }
  });
}).pipe(z.array(elementSchema)).superRefine((elements, ctx) => {
  const ids = new Map<string, number>();
  for (let i = 0; i < elements.length; i += 1) {
    const el = elements[i];
    if (!el) continue;
    const prev = ids.get(el.id);
    if (prev != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate id "${el.id}" at index ${i} (also ${prev})`,
        path: [i, "id"],
      });
    } else {
      ids.set(el.id, i);
    }
  }
  const boxIds = new Set(elements.filter((el) => el.type === "box").map((el) => el.id));
  for (let i = 0; i < elements.length; i += 1) {
    const el = elements[i];
    if (!el || el.type !== "arrow") continue;
    if (!boxIds.has(el.sourceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `arrow sourceId "${el.sourceId}" must be an existing box id`,
        path: [i, "sourceId"],
      });
    }
    if (!boxIds.has(el.targetId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `arrow targetId "${el.targetId}" must be an existing box id`,
        path: [i, "targetId"],
      });
    }
  }
});

export const sceneEnvelopeSchema = z.object({
  elements: sceneSchema,
});

export const reviewIssueSchema = z.object({
  problem: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  frameIndex: z.number().int().min(0).optional(),
});

export const reviewSchema = z.object({
  clarity: z.number().min(0).max(10),
  readability: z.number().min(0).max(10),
  accuracy: z.number().min(0).max(10),
  issues: z.array(reviewIssueSchema).default([]),
});

export type ReviewResult = z.infer<typeof reviewSchema>;
export type ReviewIssue = z.infer<typeof reviewIssueSchema>;
export type ReviewScores = {
  clarity: number;
  readability: number;
  accuracy: number;
  overall: number;
};

export function overallScore(review: Pick<ReviewResult, "clarity" | "readability" | "accuracy">): number {
  return Math.min(review.clarity, review.readability, review.accuracy);
}

export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function parseScene(data: unknown): CanvasElement[] {
  return sceneSchema.parse(data) as CanvasElement[];
}

export function parseSceneEnvelope(data: unknown): CanvasElement[] {
  if (Array.isArray(data)) {
    return parseScene(data);
  }
  return sceneEnvelopeSchema.parse(data).elements as CanvasElement[];
}

export function safeParseScene(data: unknown): { ok: true; elements: CanvasElement[] } | { ok: false; error: string } {
  try {
    if (Array.isArray(data)) {
      return { ok: true, elements: parseScene(data) };
    }
    return { ok: true, elements: parseSceneEnvelope(data) };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, error: formatZodIssues(error) };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function parseReview(data: unknown): ReviewResult {
  return reviewSchema.parse(data);
}
