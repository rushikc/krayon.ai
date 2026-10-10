import type { DesignMarkersProps } from "../types";

export function Markers({ markerPrefix }: DesignMarkersProps) {
  return (
    <marker
      id={`${markerPrefix}-arrowhead-calidraw`}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="6"
      markerHeight="6"
      orient="auto-start-reverse"
      markerUnits="strokeWidth"
    >
      <path
        d="M 1 1 L 9 5 L 1 9"
        fill="none"
        stroke="var(--ds-ink)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </marker>
  );
}
