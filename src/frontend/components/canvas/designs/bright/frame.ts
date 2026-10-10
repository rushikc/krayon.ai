import type { CSSProperties } from "react";

export const frameClassName =
  "border-2 border-[var(--ds-ink)] bg-[var(--ds-surface)] text-[var(--ds-ink)]";

export function frameStyle(exporting: boolean): CSSProperties {
  return {
    backgroundImage: exporting
      ? "radial-gradient(circle, rgba(0, 0, 0, 0.1) 1px, transparent 1px)"
      : "radial-gradient(circle, color-mix(in srgb, currentColor 10%, transparent) 1px, transparent 1px)",
    backgroundSize: "24px 24px",
  };
}

export const exportBackground = "#ffffff";
export const exportBackgroundImage =
  "radial-gradient(circle, rgba(0, 0, 0, 0.1) 1px, transparent 1px)";
export const exportBackgroundSize = "24px 24px";
export const exportBackgroundPosition = "center";
export const exportBackgroundRepeat = "repeat";
