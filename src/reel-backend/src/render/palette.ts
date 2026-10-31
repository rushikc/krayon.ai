import type { ColorTheme } from "../canvas/types.js";

export const BRIGHT = {
  surface: "#ffffff",
  ink: "#000000",
  fills: {
    ink: "#000000",
    violet: "#c9a0f0",
    green: "#5fd69b",
    blue: "#5aa9f0",
    sky: "#a9c9f5",
    lavender: "#ded4f7",
    mint: "#a6e9c6",
    tan: "#e9c989",
    yellow: "#f4d64e",
    orange: "#f9c173",
    pink: "#f8b9d0",
    salmon: "#f7aaa9",
  } satisfies Record<ColorTheme, string>,
};

export function fillFor(theme: ColorTheme): string {
  return BRIGHT.fills[theme];
}

export function textOn(theme: ColorTheme): { primary: string; secondary: string } {
  if (theme === "ink") {
    return { primary: BRIGHT.surface, secondary: "rgba(255,255,255,0.75)" };
  }
  return { primary: BRIGHT.ink, secondary: "rgba(0,0,0,0.75)" };
}
