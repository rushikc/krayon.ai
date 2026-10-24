import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

import {
  clampElementTime,
  MIN_SEGMENT_DURATION,
} from "@/components/editor/timeline/lib/timeMath";
import { FieldLabel } from "@/components/ui/field-label";
import {
  clampBoxBounds,
  clampBoxFontSize,
  clampNumberBounds,
  clampNumberSize,
  DEFAULT_BOX_FONT_SIZE,
  matrixToPercents,
  MAX_BOX_FONT_SIZE,
  MAX_NUMBER_SIZE,
  MIN_BOX_FONT_SIZE,
  MIN_BOX_SIZE,
  MIN_NUMBER_SIZE,
  numberBadgeSize,
  percentsToMatrix,
  percentsToNumberMatrix,
} from "@/lib/canvas-geometry";
import { humanizeCamelCase } from "@/lib/humanize-camel-case";
import { cn } from "@/lib/utils";
import {
  isArrowNode,
  isBoxNode,
  isNumberNode,
  type ArrowNode,
  type ArrowVariant,
  type BoxNode,
  type CanvasElement,
  type ColorTheme,
  type NumberNode,
} from "@/types/canvas";

const COLOR_THEMES: ColorTheme[] = [
  "ink",
  "violet",
  "green",
  "blue",
  "sky",
  "lavender",
  "mint",
  "tan",
  "yellow",
  "orange",
  "pink",
  "salmon",
];

/** Swatch fills for inspector chrome, not canvas paint. */
export const elementSwatchStyles: Record<ColorTheme, string> = {
  ink: "bg-neutral-950",
  violet: "bg-[#c9a0f0]",
  green: "bg-[#5fd69b]",
  blue: "bg-[#5aa9f0]",
  sky: "bg-[#a9c9f5]",
  lavender: "bg-[#ded4f7]",
  mint: "bg-[#a6e9c6]",
  tan: "bg-[#e9c989]",
  yellow: "bg-[#f4d64e]",
  orange: "bg-[#f9c173]",
  pink: "bg-[#f8b9d0]",
  salmon: "bg-[#f7aaa9]",
};

const configControlClass =
  "h-8 w-full rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground outline-none transition-colors hover:border-foreground/30 focus-visible:ring-1 focus-visible:ring-primary";
const configNumberClass = `${configControlClass} font-mono`;
const fieldLabelClass = "text-xs text-foreground";

function parseNumber(raw: string) {
  const value = Number(raw);
  if (Number.isNaN(value)) {
    return null;
  }
  return value;
}

function ConfigSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <h3 className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="grid gap-y-2">{children}</div>
    </section>
  );
}

function ConfigField({
  label,
  help,
  compact = false,
  children,
}: {
  label: string;
  help?: string;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      className={
        compact
          ? "flex items-center gap-3"
          : "grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-3"
      }
    >
      <FieldLabel
        label={label}
        help={help}
        className={
          compact
            ? "shrink-0 min-w-fit text-xs text-foreground"
            : fieldLabelClass
        }
      />
      <div className={compact ? "min-w-0 flex-1" : "min-w-0"}>{children}</div>
    </label>
  );
}

function NumberField({
  label,
  help,
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  compact = false,
}: {
  label: string;
  help: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  compact?: boolean;
}) {
  return (
    <ConfigField label={label} help={help} compact={compact}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        className={configNumberClass}
        value={value}
        onChange={(event) => {
          const next = parseNumber(event.target.value);
          if (next === null) {
            return;
          }
          onValueChange(next);
        }}
      />
    </ConfigField>
  );
}

function SliderNumberField({
  label,
  help,
  value,
  min,
  max,
  step,
  onValueChange,
}: {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange: (value: number) => void;
}) {
  return (
    <ConfigField label={label} help={help}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          className={cn(configNumberClass, "w-16 shrink-0")}
          value={value}
          onChange={(event) => {
            const next = parseNumber(event.target.value);
            if (next === null) {
              return;
            }
            onValueChange(next);
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          aria-label={humanizeCamelCase(label)}
          className="h-8 w-full min-w-0 flex-1 cursor-pointer accent-primary"
          value={value}
          onChange={(event) => onValueChange(Number(event.target.value))}
        />
      </div>
    </ConfigField>
  );
}

function TimeFields({
  element,
  duration,
  onChange,
}: {
  element: CanvasElement;
  duration: number;
  onChange: (next: CanvasElement) => void;
}) {
  function updateTime(field: "start" | "end", next: number) {
    onChange({
      ...element,
      time: {
        ...element.time,
        [field]: next,
      },
    });
  }

  return (
    <div className="grid grid-cols-2 gap-6">
      <NumberField
        compact
        label="start"
        help="Clip start time in seconds on the reel timeline."
        value={element.time.start}
        min={0}
        max={duration}
        step={0.1}
        onValueChange={(next) => updateTime("start", next)}
      />
      <NumberField
        compact
        label="end"
        help="Clip end time in seconds. Minimum duration is 0.5s."
        value={element.time.end}
        min={0}
        max={10_000}
        step={0.1}
        onValueChange={(next) => updateTime("end", next)}
      />
    </div>
  );
}

function BoxConfigForm({
  node,
  duration,
  onChange,
}: {
  node: BoxNode;
  duration: number;
  onChange: (next: CanvasElement) => void;
}) {
  const rect = matrixToPercents(node.matrix);

  function updateGeometry(
    field: "x" | "y" | "width" | "height",
    next: number,
  ) {
    const clamped = clampBoxBounds({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      [field]: next,
    });

    onChange({
      ...node,
      matrix: percentsToMatrix({
        left: clamped.x,
        top: clamped.y,
        width: clamped.width,
        height: clamped.height,
      }),
    });
  }

  return (
    <div className="px-4 py-3">
      <ConfigSection title="Content">
        <ConfigField label="label" help="Visible text shown inside the box.">
          <input
            className={configControlClass}
            value={node.label}
            onChange={(event) => onChange({ ...node, label: event.target.value })}
          />
        </ConfigField>
        <ConfigField
          label="sublabel"
          help="Optional supporting text shown below the main label."
        >
          <input
            className={configControlClass}
            value={node.sublabel ?? ""}
            onChange={(event) =>
              onChange({
                ...node,
                sublabel: event.target.value || undefined,
              })
            }
          />
        </ConfigField>
      </ConfigSection>

      <ConfigSection title="Style">
        <ConfigField
          label="colorTheme"
          help="Fill color used by the infographic box."
        >
          <select
            className={configControlClass}
            value={node.colorTheme}
            onChange={(event) =>
              onChange({
                ...node,
                colorTheme: event.target.value as ColorTheme,
              })
            }
          >
            {COLOR_THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {theme}
              </option>
            ))}
          </select>
        </ConfigField>
        <SliderNumberField
          label="fontSize"
          help="Label text size in pixels. Sublabel scales proportionally."
          value={node.fontSize ?? DEFAULT_BOX_FONT_SIZE}
          min={MIN_BOX_FONT_SIZE}
          max={MAX_BOX_FONT_SIZE}
          step={1}
          onValueChange={(next) =>
            onChange({ ...node, fontSize: clampBoxFontSize(next) })
          }
        />
      </ConfigSection>

      <ConfigSection title="Layout">
        <div className="grid grid-cols-2 gap-6">
          <NumberField
            compact
            label="x"
            help="Left edge as a percentage of canvas width (0–100)."
            value={rect.left}
            onValueChange={(next) => updateGeometry("x", next)}
          />
          <NumberField
            compact
            label="y"
            help="Top edge as a percentage of canvas height (0–100)."
            value={rect.top}
            onValueChange={(next) => updateGeometry("y", next)}
          />
        </div>
        <SliderNumberField
          label="width"
          help="Box width as a percentage of canvas width (0–100)."
          value={rect.width}
          min={MIN_BOX_SIZE}
          max={100}
          step={1}
          onValueChange={(next) => updateGeometry("width", next)}
        />
        <SliderNumberField
          label="height"
          help="Box height as a percentage of canvas height (0–100)."
          value={rect.height}
          min={MIN_BOX_SIZE}
          max={100}
          step={1}
          onValueChange={(next) => updateGeometry("height", next)}
        />
      </ConfigSection>

      <ConfigSection title="Timing">
        <TimeFields element={node} duration={duration} onChange={onChange} />
      </ConfigSection>
    </div>
  );
}

function NumberConfigForm({
  node,
  duration,
  onChange,
}: {
  node: NumberNode;
  duration: number;
  onChange: (next: CanvasElement) => void;
}) {
  const rect = matrixToPercents(node.matrix);
  const badgeSize = numberBadgeSize(node);

  function updatePosition(field: "x" | "y", next: number) {
    const clamped = clampNumberBounds({
      x: rect.left,
      y: rect.top,
      size: badgeSize,
      [field]: next,
    });

    onChange({
      ...node,
      matrix: percentsToNumberMatrix({
        left: clamped.x,
        top: clamped.y,
        width: rect.width,
        height: rect.height,
      }),
    });
  }

  return (
    <div className="px-4 py-3">
      <ConfigSection title="Content">
        <ConfigField label="value" help="Digit(s) shown inside the badge.">
          <input
            type="number"
            step={1}
            className={configNumberClass}
            value={node.value}
            onChange={(event) => {
              const next = parseNumber(event.target.value);
              if (next === null) {
                return;
              }
              onChange({ ...node, value: next });
            }}
          />
        </ConfigField>
        <ConfigField
          label="colorTheme"
          help="Fill color for the circular badge."
        >
          <select
            className={configControlClass}
            value={node.colorTheme}
            onChange={(event) =>
              onChange({
                ...node,
                colorTheme: event.target.value as ColorTheme,
              })
            }
          >
            {COLOR_THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {theme}
              </option>
            ))}
          </select>
        </ConfigField>
      </ConfigSection>

      <ConfigSection title="Layout">
        <div className="grid grid-cols-2 gap-6">
          <NumberField
            compact
            label="x"
            help="Left edge as a percentage of canvas width (0–100)."
            value={rect.left}
            onValueChange={(next) => updatePosition("x", next)}
          />
          <NumberField
            compact
            label="y"
            help="Top edge as a percentage of canvas height (0–100)."
            value={rect.top}
            onValueChange={(next) => updatePosition("y", next)}
          />
        </div>
        <SliderNumberField
          label="size"
          help="Badge diameter as a percentage of canvas width (4–40). Overrides matrix width when set."
          value={badgeSize}
          min={MIN_NUMBER_SIZE}
          max={MAX_NUMBER_SIZE}
          step={1}
          onValueChange={(next) =>
            onChange({ ...node, size: clampNumberSize(next) })
          }
        />
      </ConfigSection>

      <ConfigSection title="Timing">
        <TimeFields element={node} duration={duration} onChange={onChange} />
      </ConfigSection>
    </div>
  );
}

function ArrowConfigForm({
  node,
  boxIds,
  duration,
  onChange,
}: {
  node: ArrowNode;
  boxIds: string[];
  duration: number;
  onChange: (next: CanvasElement) => void;
}) {
  return (
    <div className="px-4 py-3">
      <ConfigSection title="Connection">
        <ConfigField label="sourceId" help="Box this arrow starts from.">
          <select
            className={configControlClass}
            value={node.sourceId}
            onChange={(event) =>
              onChange({ ...node, sourceId: event.target.value })
            }
          >
            {boxIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </ConfigField>
        <ConfigField label="targetId" help="Box this arrow points to.">
          <select
            className={configControlClass}
            value={node.targetId}
            onChange={(event) =>
              onChange({ ...node, targetId: event.target.value })
            }
          >
            {boxIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </ConfigField>
        <ConfigField
          label="variant"
          help="Use a continuous or dotted-style dashed connection."
        >
          <select
            className={configControlClass}
            value={node.variant ?? "solid"}
            onChange={(event) =>
              onChange({
                ...node,
                variant: event.target.value as ArrowVariant,
              })
            }
          >
            <option value="solid">solid</option>
            <option value="dashed">dashed</option>
          </select>
        </ConfigField>
      </ConfigSection>

      <ConfigSection title="Timing">
        <TimeFields element={node} duration={duration} onChange={onChange} />
      </ConfigSection>
    </div>
  );
}

export function elementConfigErrors(
  element: CanvasElement,
  boxIds: string[],
): string[] {
  const errors: string[] = [];
  const { start, end } = element.time;
  if (!Number.isFinite(start) || start < 0) {
    errors.push("Start time must be 0 or greater.");
  }
  if (!Number.isFinite(end)) {
    errors.push("End time must be a number.");
  } else if (end - start < MIN_SEGMENT_DURATION) {
    errors.push(`Duration must be at least ${MIN_SEGMENT_DURATION}s.`);
  }
  if (isArrowNode(element)) {
    if (element.sourceId === element.targetId) {
      errors.push("Arrow source and target must be different boxes.");
    }
    if (!boxIds.includes(element.sourceId)) {
      errors.push("Arrow source must be an existing box.");
    }
    if (!boxIds.includes(element.targetId)) {
      errors.push("Arrow target must be an existing box.");
    }
  }
  return errors;
}

export function ElementGlyph({ element }: { element: CanvasElement }) {
  if (isBoxNode(element)) {
    return (
      <span
        aria-hidden
        className={cn(
          "size-6 shrink-0 rounded-md border border-canvas-ink/20",
          elementSwatchStyles[element.colorTheme],
        )}
      />
    );
  }

  if (isNumberNode(element)) {
    return (
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border border-canvas-ink/20 text-[10px] font-semibold text-canvas-ink",
          elementSwatchStyles[element.colorTheme],
        )}
      >
        {element.value}
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
    >
      <ArrowRight className="size-3.5" />
    </span>
  );
}

export function ElementConfigForm({
  element,
  boxIds,
  duration,
  onChange,
}: {
  element: CanvasElement;
  boxIds: string[];
  duration: number;
  onChange: (next: CanvasElement) => void;
}) {
  if (isBoxNode(element)) {
    return (
      <BoxConfigForm node={element} duration={duration} onChange={onChange} />
    );
  }
  if (isNumberNode(element)) {
    return (
      <NumberConfigForm node={element} duration={duration} onChange={onChange} />
    );
  }
  if (isArrowNode(element)) {
    return (
      <ArrowConfigForm
        node={element}
        boxIds={boxIds}
        duration={duration}
        onChange={onChange}
      />
    );
  }
  return null;
}

/** Apply the same time clamp the live inspector used on each edit. */
export function clampConfigElementTime(element: CanvasElement): CanvasElement {
  const clamped = clampElementTime(
    element.time.start,
    element.time.end,
    Number.POSITIVE_INFINITY,
  );
  return {
    ...element,
    time: {
      ...element.time,
      start: clamped.start,
      end: clamped.end,
    },
  };
}
