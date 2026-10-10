import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Braces,
  ChevronRight,
  Copy,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { clampElementTime } from "@/components/editor/timeline/lib/timeMath";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { clampBoxBounds, clampNumberBounds, clampBoxFontSize, clampNumberSize, DEFAULT_BOX_FONT_SIZE, matrixToPercents, MAX_BOX_FONT_SIZE, MAX_NUMBER_SIZE, MIN_BOX_FONT_SIZE, MIN_BOX_SIZE, MIN_NUMBER_SIZE, numberBadgeSize, percentsToMatrix, percentsToNumberMatrix } from "@/lib/canvas-geometry";
import { isElementActiveAt } from "@/lib/element-visibility";
import { humanizeCamelCase } from "@/lib/humanize-camel-case";
import { parseCanvasElementsJson } from "@/lib/parse-canvas-json";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvas-store";
import { toast } from "@/stores/toast-store";
import {
  getElementLabel,
  isArrowNode,
  isBoxNode,
  isNumberNode,
  type ArrowNode,
  type ArrowVariant,
  type BoxNode,
  type CanvasElement,
  type ColorTheme,
  type ElementTime,
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

/** Swatch fills for the element list (inspector chrome, not canvas paint). */
const swatchStyles: Record<ColorTheme, string> = {
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

function TimeFields({ element }: { element: CanvasElement }) {
  const duration = useCanvasStore((state) => state.duration);
  const updateElement = useCanvasStore((state) => state.updateElement);

  function updateTime(field: "start" | "end", next: number) {
    const clamped = clampElementTime(
      field === "start" ? next : element.time.start,
      field === "end" ? next : element.time.end,
      Number.POSITIVE_INFINITY,
    );

    updateElement(element.id, {
      time: {
        ...element.time,
        start: clamped.start,
        end: clamped.end,
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

function BoxConfigForm({ node }: { node: BoxNode }) {
  const updateElement = useCanvasStore((state) => state.updateElement);
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

    updateElement(node.id, {
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
            onChange={(event) =>
              updateElement(node.id, { label: event.target.value })
            }
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
              updateElement(node.id, {
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
              updateElement(node.id, {
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
            updateElement(node.id, { fontSize: clampBoxFontSize(next) })
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
        <TimeFields element={node} />
      </ConfigSection>
    </div>
  );
}

function NumberConfigForm({ node }: { node: NumberNode }) {
  const updateElement = useCanvasStore((state) => state.updateElement);
  const rect = matrixToPercents(node.matrix);
  const badgeSize = numberBadgeSize(node);

  function updatePosition(field: "x" | "y", next: number) {
    const clamped = clampNumberBounds({
      x: rect.left,
      y: rect.top,
      size: badgeSize,
      [field]: next,
    });

    updateElement(node.id, {
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
              updateElement(node.id, { value: next });
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
              updateElement(node.id, {
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
            updateElement(node.id, { size: clampNumberSize(next) })
          }
        />
      </ConfigSection>

      <ConfigSection title="Timing">
        <TimeFields element={node} />
      </ConfigSection>
    </div>
  );
}

function ArrowConfigForm({
  node,
  boxIds,
}: {
  node: ArrowNode;
  boxIds: string[];
}) {
  const updateElement = useCanvasStore((state) => state.updateElement);

  return (
    <div className="px-4 py-3">
      <ConfigSection title="Connection">
        <ConfigField label="sourceId" help="Box this arrow starts from.">
          <select
            className={configControlClass}
            value={node.sourceId}
            onChange={(event) =>
              updateElement(node.id, { sourceId: event.target.value })
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
              updateElement(node.id, { targetId: event.target.value })
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
              updateElement(node.id, {
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
        <TimeFields element={node} />
      </ConfigSection>
    </div>
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

export function SchemaInspector({
  projectName = "krayon-reel",
  onProjectNameChange,
}: {
  projectName?: string;
  onProjectNameChange?: (name: string) => void;
}) {
  const elements = useCanvasStore((state) => state.elements);
  const selectedId = useCanvasStore((state) => state.selectedId);
  const selectElement = useCanvasStore((state) => state.selectElement);
  const currentTime = useCanvasStore((state) => state.currentTime);
  const selected = elements.find((element) => element.id === selectedId) ?? null;
  const boxes = elements.filter(isBoxNode);
  const [tab, setTab] = useState<"config" | "json">("config");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (selectedId) {
      setTab("config");
    }
  }, [selectedId]);

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-muted/30">
      <nav
        aria-label="Inspector"
        className="flex shrink-0 items-center gap-1 border-b border-border px-2"
      >
        <TabButton
          label="Config"
          active={tab === "config"}
          onClick={() => setTab("config")}
          icon={SlidersHorizontal}
        />
        <TabButton
          label="JSON"
          active={tab === "json"}
          onClick={() => setTab("json")}
          icon={Braces}
        />
        <div className="ml-auto flex min-w-0 max-w-[18rem] items-center gap-2">
          <label
            htmlFor="project-name"
            className="shrink-0 text-[16px] font-medium text-muted-foreground"
          >
            Project name
          </label>
          <Input
            id="project-name"
            placeholder="krayon-reel"
            value={projectName}
            onValueChange={(value) => onProjectNameChange?.(value)}
            className="h-8 min-w-0 border-transparent bg-transparent px-2 text-sm font-semibold tracking-tight shadow-none hover:border-border focus-visible:border-ring"
          />
        </div>
      </nav>

      {tab === "config" && selected ? (
        <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-3 py-2.5">
          <button
            type="button"
            aria-label="Back to element list"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => selectElement(null)}
          >
            <ArrowLeft className="size-3.5" />
          </button>
          <ElementGlyph element={selected} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight">
              {getElementLabel(selected)}
            </h2>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {selected.type} · {selected.id}
            </p>
          </div>
          <span className="ml-auto shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {formatTimeRange(selected.time)}
          </span>
        </div>
      ) : null}

      {tab === "config" && !selected ? (
        <div className="shrink-0 border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label="Search elements"
              placeholder="Search elements"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-lg border border-border bg-background py-1.5 pr-2 pl-8 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
      ) : null}

      {tab === "json" ? (
        <div className="min-h-0 flex-1">
          <JsonEditor elements={elements} />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          {selected && isBoxNode(selected) ? (
            <BoxConfigForm node={selected} />
          ) : selected && isNumberNode(selected) ? (
            <NumberConfigForm node={selected} />
          ) : selected && isArrowNode(selected) ? (
            <ArrowConfigForm
              node={selected}
              boxIds={boxes.map((box) => box.id)}
            />
          ) : (
            <ElementList
              elements={elements}
              query={query}
              currentTime={currentTime}
              onSelect={selectElement}
            />
          )}
        </ScrollArea>
      )}
    </aside>
  );
}

function JsonEditor({ elements }: { elements: CanvasElement[] }) {
  const setElements = useCanvasStore((state) => state.setElements);
  const canonical = JSON.stringify(elements, null, 2);
  const [draft, setDraft] = useState(canonical);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) {
      setDraft(canonical);
    }
  }, [canonical, dirty]);

  function applyDraft() {
    const parsed = parseCanvasElementsJson(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setDirty(false);
    setElements(parsed.elements);
  }

  return (
    <div className="flex h-full min-h-[240px] flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs font-medium text-foreground hover:bg-muted"
          onClick={() => {
            void navigator.clipboard.writeText(draft).then(() => {
              toast("Copied JSON");
            });
          }}
        >
          <Copy className="size-3.5" />
          Copy
        </button>
        {error ? (
          <p className="min-w-0 truncate text-[11px] text-destructive">{error}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Blur or Cmd/Ctrl+Enter to apply
          </p>
        )}
      </div>
      <textarea
        aria-label="Scene JSON"
        spellCheck={false}
        className="min-h-0 flex-1 resize-none bg-background p-4 font-mono text-[11px] leading-5 text-foreground outline-none"
        value={draft}
        onChange={(event) => {
          setDirty(true);
          setDraft(event.target.value);
        }}
        onBlur={applyDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            applyDraft();
          }
        }}
      />
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
  icon: Icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: typeof SlidersHorizontal;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "relative flex h-10 items-center gap-1.5 px-3 text-xs font-medium transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
      {active ? (
        <span
          aria-hidden
          className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
        />
      ) : null}
    </button>
  );
}

function matchesQuery(element: CanvasElement, query: string) {
  return `${getElementLabel(element)} ${element.type} ${element.id}`
    .toLowerCase()
    .includes(query);
}

function ElementList({
  elements,
  query,
  currentTime,
  onSelect,
}: {
  elements: CanvasElement[];
  query: string;
  currentTime: number;
  onSelect: (id: string) => void;
}) {
  if (elements.length === 0) {
    return (
      <p className="px-5 py-6 text-[11px] leading-5 text-muted-foreground">
        No elements on the canvas yet.
      </p>
    );
  }

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? elements.filter((element) => matchesQuery(element, needle))
    : elements;

  if (visible.length === 0) {
    return (
      <p className="px-5 py-6 text-[11px] leading-5 text-muted-foreground">
        No elements match “{query.trim()}”.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-1 p-2 sm:grid-cols-2">
      {visible.map((element) => {
        const active = isElementActiveAt(element.time, currentTime);
        return (
          <li key={element.id}>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                active
                  ? "border-primary/25 bg-primary/5 hover:bg-primary/10"
                  : "border-transparent hover:border-border hover:bg-muted",
              )}
              onClick={() => onSelect(element.id)}
            >
              <ElementGlyph element={element} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">
                  {getElementLabel(element)}
                </span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {element.type} · {element.id}
                </span>
              </span>
              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                {formatTimeRange(element.time)}
              </span>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ElementGlyph({ element }: { element: CanvasElement }) {
  if (isBoxNode(element)) {
    return (
      <span
        aria-hidden
        className={cn(
          "size-6 shrink-0 rounded-md border border-canvas-ink/20",
          swatchStyles[element.colorTheme],
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
          swatchStyles[element.colorTheme],
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

function formatSeconds(value: number) {
  return String(Number(value.toFixed(1)));
}

function formatTimeRange(time: ElementTime) {
  return `${formatSeconds(time.start)}–${formatSeconds(time.end)}s`;
}
