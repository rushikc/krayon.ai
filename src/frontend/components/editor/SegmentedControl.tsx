import type { LucideIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SegmentGroup({
  label,
  children,
  tabList = false,
  prominent = false,
}: {
  label: string;
  children: ReactNode;
  tabList?: boolean;
  prominent?: boolean;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!tabList || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) {
      return;
    }
    const tabs = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
    ];
    if (tabs.length === 0) {
      return;
    }
    const current = tabs.findIndex((tab) => tab === document.activeElement);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(current + delta + tabs.length) % tabs.length];
    if (!next) {
      return;
    }
    event.preventDefault();
    next.focus();
    next.click();
  }

  return (
    <div
      role={tabList ? "tablist" : "group"}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-background p-0.5",
        prominent && "p-1",
      )}
    >
      {children}
    </div>
  );
}

export function Segment({
  label,
  icon: Icon,
  active,
  onClick,
  disabled,
  tab = false,
  prominent = false,
}: {
  label: string;
  icon?: LucideIcon;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  tab?: boolean;
  prominent?: boolean;
}) {
  return (
    <button
      type="button"
      role={tab ? "tab" : undefined}
      aria-selected={tab ? active : undefined}
      aria-pressed={tab ? undefined : active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50",
        prominent
          ? "h-8 gap-2 rounded-md px-3.5 text-sm font-medium"
          : "h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium",
        active && prominent && "bg-primary text-primary-foreground",
        active && !prominent && "bg-card text-primary shadow-sm",
        !active && "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
      )}
    >
      {Icon ? (
        <Icon className={prominent ? "size-4" : "size-3.5"} />
      ) : null}
      {label}
    </button>
  );
}
