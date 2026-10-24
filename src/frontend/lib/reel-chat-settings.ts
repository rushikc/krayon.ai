export const REEL_THREAD_IDS_STORAGE_KEY = "krayon-reel-thread-ids";
export const REEL_MAX_ROUNDS_STORAGE_KEY = "krayon-reel-max-rounds";
export const REEL_MODELS_STORAGE_KEY = "krayon-reel-models";

export type ChatModelOverrides = {
  generate: string;
  review: string;
  fix: string;
};

const EMPTY_MODELS: ChatModelOverrides = {
  generate: "",
  review: "",
  fix: "",
};

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable
  }
}

export function getStoredThreadJobIds(): string[] {
  const raw = readItem(REEL_THREAD_IDS_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function persistThreadJobIds(ids: string[]): void {
  writeItem(REEL_THREAD_IDS_STORAGE_KEY, JSON.stringify(ids));
}

export function getStoredMaxRounds(): number {
  const raw = readItem(REEL_MAX_ROUNDS_STORAGE_KEY);
  const value = raw ? Number(raw) : 2;
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    return 2;
  }
  return value;
}

export function persistMaxRounds(value: number): void {
  writeItem(REEL_MAX_ROUNDS_STORAGE_KEY, String(value));
}

export function getStoredModelOverrides(): ChatModelOverrides {
  const raw = readItem(REEL_MODELS_STORAGE_KEY);
  if (!raw) {
    return { ...EMPTY_MODELS };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { ...EMPTY_MODELS };
    }
    const record = parsed as Record<string, unknown>;
    return {
      generate: typeof record.generate === "string" ? record.generate : "",
      review: typeof record.review === "string" ? record.review : "",
      fix: typeof record.fix === "string" ? record.fix : "",
    };
  } catch {
    return { ...EMPTY_MODELS };
  }
}

export function persistModelOverrides(models: ChatModelOverrides): void {
  writeItem(REEL_MODELS_STORAGE_KEY, JSON.stringify(models));
}

export function modelsForRequest(
  models: ChatModelOverrides,
): { generate?: string; review?: string; fix?: string } | undefined {
  const next: { generate?: string; review?: string; fix?: string } = {};
  if (models.generate.trim()) {
    next.generate = models.generate.trim();
  }
  if (models.review.trim()) {
    next.review = models.review.trim();
  }
  if (models.fix.trim()) {
    next.fix = models.fix.trim();
  }
  return Object.keys(next).length > 0 ? next : undefined;
}
