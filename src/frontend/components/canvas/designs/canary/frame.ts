import type { CSSProperties } from "react";

import backgroundUrl from "./background.jpg?inline";

const backgroundImage = `url("${backgroundUrl}")`;

export const frameClassName =
  "border-2 border-[var(--ds-ink)] bg-[var(--ds-surface)] text-[var(--ds-ink)]";

export function frameStyle(_exporting: boolean): CSSProperties {
  return {
    backgroundImage,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
}

export const exportBackground = "#000000";
export const exportBackgroundImage = backgroundImage;
export const exportBackgroundSize = "cover";
export const exportBackgroundPosition = "center";
export const exportBackgroundRepeat = "no-repeat";
