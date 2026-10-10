import { sketchCirclePath, sketchRoundedRectPath, sketchViewBox } from "./sketch-path";

interface SketchFrameProps {
  id: string;
  kind: "rect" | "circle";
  stroke: string;
  fill: string;
  aspect?: number;
}

export function SketchFrame({
  id,
  kind,
  stroke,
  fill,
  aspect = 1,
}: SketchFrameProps) {
  const d =
    kind === "rect"
      ? sketchRoundedRectPath(id, { aspect })
      : sketchCirclePath(id);

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      viewBox={kind === "rect" ? sketchViewBox(aspect) : "0 0 100 100"}
      preserveAspectRatio="none"
    >
      <path
        d={d}
        fill={fill}
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
