export type RenderTheme =
  | "bright"
  | "dark"
  | "calidraw-light"
  | "calidraw-dark"
  | "canary";

export const RENDER_THEMES: { id: RenderTheme; label: string }[] = [
  { id: "bright", label: "Bright" },
  { id: "dark", label: "Dark" },
  { id: "calidraw-light", label: "Calidraw light" },
  { id: "calidraw-dark", label: "Calidraw dark" },
  { id: "canary", label: "Canary" },
];

export function isRenderTheme(value: string | null): value is RenderTheme {
  return (
    value === "bright" ||
    value === "dark" ||
    value === "calidraw-light" ||
    value === "calidraw-dark" ||
    value === "canary"
  );
}
