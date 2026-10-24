export const GEMINI_API_KEY_COOKIE = "krayon_gemini_api_key";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function cookieFlags(maxAge: number): string {
  const secure =
    typeof location !== "undefined" && location.protocol === "https:"
      ? "; Secure"
      : "";
  return `; Path=/; Max-Age=${maxAge}; SameSite=Strict${secure}`;
}

export function getGeminiApiKey(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const prefix = `${GEMINI_API_KEY_COOKIE}=`;
  const parts = document.cookie.split("; ");
  for (const part of parts) {
    if (part.startsWith(prefix)) {
      const value = decodeURIComponent(part.slice(prefix.length));
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

export function setGeminiApiKey(value: string): void {
  const trimmed = value.trim();
  if (!trimmed) {
    clearGeminiApiKey();
    return;
  }
  document.cookie = `${GEMINI_API_KEY_COOKIE}=${encodeURIComponent(trimmed)}${cookieFlags(MAX_AGE_SECONDS)}`;
}

export function clearGeminiApiKey(): void {
  document.cookie = `${GEMINI_API_KEY_COOKIE}=${cookieFlags(0)}`;
}

export function maskGeminiApiKey(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return `••••${trimmed}`;
  }
  return `••••${trimmed.slice(-4)}`;
}
