import type { Meta } from "./store.js";

export const TITLE_MAX = 80;

export function slugifyName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function compactSlug(slug: string): string {
  return slug.replace(/-/g, "");
}

export function normalizeTitle(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseProjectTitle(raw: string | undefined): { ok: true; title: string } | { ok: false; message: string } {
  const title = (raw ?? "").trim();
  if (!title) return { ok: false, message: "Project name is required" };
  if (title.length > TITLE_MAX) return { ok: false, message: `Project name must be at most ${TITLE_MAX} characters` };
  if (!slugifyName(title)) {
    return { ok: false, message: "Project name must include a letter or number" };
  }
  return { ok: true, title };
}

export function nameConflict(existing: Meta[], title: string, slug: string): Meta | undefined {
  const compact = compactSlug(slug);
  const normalized = normalizeTitle(title);
  return existing.find(
    (item) =>
      item.slug === slug ||
      compactSlug(item.slug) === compact ||
      normalizeTitle(item.title) === normalized,
  );
}

export function checkNameAvailability(
  existing: Meta[],
  name: string,
  slugOverride?: string,
): { available: boolean; reason?: string; title?: string; slug?: string } {
  const parsed = parseProjectTitle(name);
  if (!parsed.ok) return { available: false, reason: parsed.message };
  const slug = slugOverride ? slugifyName(slugOverride) : slugifyName(parsed.title);
  if (!slug) return { available: false, reason: "Project name must include a letter or number" };
  const hit = nameConflict(existing, parsed.title, slug);
  if (hit) {
    return {
      available: false,
      reason: `A project named "${parsed.title}" already exists`,
      title: parsed.title,
      slug,
    };
  }
  return { available: true, title: parsed.title, slug };
}
