import { afterEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY, applyTheme, getStoredTheme, persistTheme } from "@/lib/theme";

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("theme", () => {
  it("defaults to dark and round-trips light", () => {
    expect(THEME_STORAGE_KEY).toBe("krayon-theme");
    expect(getStoredTheme()).toBe("dark");
    persistTheme("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(getStoredTheme()).toBe("light");
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("ignores an unknown stored value", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(getStoredTheme()).toBe("dark");
  });
});
