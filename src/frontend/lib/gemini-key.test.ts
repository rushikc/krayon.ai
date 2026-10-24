import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GEMINI_API_KEY_COOKIE,
  clearGeminiApiKey,
  getGeminiApiKey,
  maskGeminiApiKey,
  setGeminiApiKey,
} from "@/lib/gemini-key";

function cookieHas(flag: string): boolean {
  return document.cookie.includes(flag) || lastWrite.includes(flag);
}

let lastWrite = "";
const originalDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");

function installCookieMock(protocol: string) {
  lastWrite = "";
  let store = "";
  vi.stubGlobal("location", { protocol, href: `${protocol}//localhost/` });
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get() {
      return store;
    },
    set(value: string) {
      lastWrite = value;
      const [pair] = value.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const val = pair.slice(eq + 1);
      if (value.includes("Max-Age=0")) {
        store = store
          .split("; ")
          .filter((part) => !part.startsWith(`${name}=`))
          .join("; ");
        return;
      }
      const next = `${name}=${val}`;
      const others = store
        .split("; ")
        .filter((part) => part && !part.startsWith(`${name}=`));
      store = [...others, next].join("; ");
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalDescriptor) {
    Object.defineProperty(document, "cookie", originalDescriptor);
  }
  localStorage.clear();
});

describe("gemini-key cookie", () => {
  it("sets SameSite=Strict, Path=/, and omits Secure on http", () => {
    installCookieMock("http:");
    setGeminiApiKey("secret-key-1234");
    expect(getGeminiApiKey()).toBe("secret-key-1234");
    expect(cookieHas("SameSite=Strict")).toBe(true);
    expect(cookieHas("Path=/")).toBe(true);
    expect(cookieHas("Secure")).toBe(false);
    expect(lastWrite.includes("HttpOnly")).toBe(false);
  });

  it("adds Secure on https", () => {
    installCookieMock("https:");
    setGeminiApiKey("https-key");
    expect(cookieHas("Secure")).toBe(true);
    expect(cookieHas("SameSite=Strict")).toBe(true);
  });

  it("clears the cookie and never writes localStorage", () => {
    installCookieMock("http:");
    setGeminiApiKey("to-be-removed");
    expect(getGeminiApiKey()).toBe("to-be-removed");
    clearGeminiApiKey();
    expect(getGeminiApiKey()).toBeNull();
    expect(localStorage.getItem(GEMINI_API_KEY_COOKIE)).toBeNull();
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key) {
        expect(localStorage.getItem(key)).not.toContain("to-be-removed");
      }
    }
  });

  it("masks all but the last four characters", () => {
    expect(maskGeminiApiKey("abcd1234xyz")).toBe("••••4xyz");
    expect(maskGeminiApiKey(null)).toBeNull();
  });
});
