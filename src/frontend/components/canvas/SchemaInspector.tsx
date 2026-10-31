/**
 * Config/JSON inspector. Currently unused in the /reel-animations UI
 * (elements are edited from the timeline modal). Kept for tests and chat JSON apply.
 */
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Braces,
  ChevronRight,
  Copy,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import {
  clampConfigElementTime,
  ElementConfigForm,
  ElementGlyph,
} from "@/components/canvas/ElementConfigForm";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isElementActiveAt } from "@/lib/element-visibility";
import { parseCanvasElementsJson } from "@/lib/parse-canvas-json";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvas-store";
import { toast } from "@/stores/toast-store";
import {
  getElementLabel,
  isBoxNode,
  type CanvasElement,
  type ElementTime,
} from "@/types/canvas";

export function SchemaInspector() {
  const elements = useCanvasStore((state) => state.elements);
  const selectedId = useCanvasStore((state) => state.selectedId);
  const selectElement = useCanvasStore((state) => state.selectElement);
  const updateElement = useCanvasStore((state) => state.updateElement);
  const duration = useCanvasStore((state) => state.duration);
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
          {selected ? (
            <ElementConfigForm
              element={selected}
              boxIds={boxes.map((box) => box.id)}
              duration={duration}
              onChange={(next) => {
                const clamped = clampConfigElementTime(next);
                updateElement(clamped.id, clamped);
              }}
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

function formatSeconds(value: number) {
  return String(Number(value.toFixed(1)));
}

function formatTimeRange(time: ElementTime) {
  return `${formatSeconds(time.start)}–${formatSeconds(time.end)}s`;
}
