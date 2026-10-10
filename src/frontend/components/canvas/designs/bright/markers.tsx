import type { DesignMarkersProps } from "../types";

export function Markers({ markerPrefix }: DesignMarkersProps) {
  return (
    <marker
      id={`${markerPrefix}-arrowhead`}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="5"
      markerHeight="5"
      orient="auto-start-reverse"
      markerUnits="strokeWidth"
    >
      <path d="M 0 0 L 10 5 L 0 10 Z" fill="var(--ds-ink)" />
    </marker>
  );
}
