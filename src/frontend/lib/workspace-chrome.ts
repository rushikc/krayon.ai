import { isRenderTheme, type RenderTheme } from "@/lib/render-theme";

export const RENDER_THEME_STORAGE_KEY = "krayon-render-theme";
export const SHOW_TIMELINE_STORAGE_KEY = "krayon-show-timeline";
export const SHOW_EDITOR_STORAGE_KEY = "krayon-show-editor";
export const SHOW_REEL_PREVIEW_STORAGE_KEY = "krayon-show-reel-preview";

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

export function getStoredRenderTheme(): RenderTheme {
  const stored = readItem(RENDER_THEME_STORAGE_KEY);
  return isRenderTheme(stored) ? stored : "bright";
}

export function persistRenderTheme(theme: RenderTheme): void {
  writeItem(RENDER_THEME_STORAGE_KEY, theme);
}

function getStoredFlag(key: string, fallback: boolean): boolean {
  const stored = readItem(key);
  if (stored === "true") {
    return true;
  }
  if (stored === "false") {
    return false;
  }
  return fallback;
}

export function getStoredShowTimeline(): boolean {
  return getStoredFlag(SHOW_TIMELINE_STORAGE_KEY, true);
}

export function getStoredShowEditor(): boolean {
  return getStoredFlag(SHOW_EDITOR_STORAGE_KEY, true);
}

export function getStoredShowReelPreview(): boolean {
  return getStoredFlag(SHOW_REEL_PREVIEW_STORAGE_KEY, false);
}

export function persistShowTimeline(value: boolean): void {
  writeItem(SHOW_TIMELINE_STORAGE_KEY, String(value));
}

export function persistShowEditor(value: boolean): void {
  writeItem(SHOW_EDITOR_STORAGE_KEY, String(value));
}

export function persistShowReelPreview(value: boolean): void {
  writeItem(SHOW_REEL_PREVIEW_STORAGE_KEY, String(value));
}
