import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Button } from "@/components/ui/button";

interface AppShellProps {
  children: ReactNode;
  showBack?: boolean;
  backTo?: string;
  backLabel?: string;
  title?: string;
  subtitle?: string;
  hideHeader?: boolean;
  actions?: ReactNode;
}

export function AppShell({
  children,
  showBack = false,
  backTo = "/",
  backLabel = "Back to library",
  title,
  subtitle,
  hideHeader = false,
  actions,
}: AppShellProps) {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground selection:bg-primary/30">
      {hideHeader ? null : (
        <header className="grid h-11 shrink-0 grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-2 border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-sm font-semibold tracking-tight">
              <Link to="/">Krayon</Link>
            </h1>
            {showBack ? (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link to={backTo} />}>
                <ArrowLeft className="size-3.5" />
                {backLabel}
              </Button>
            ) : null}
          </div>
          <div className="flex min-w-0 max-w-full flex-col items-center justify-center justify-self-center">
            {title ? (
              <p className="w-full truncate text-center text-sm font-semibold text-foreground">{title}</p>
            ) : null}
            {subtitle ? (
              <p className="w-full truncate text-center text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-2">
            {actions}
            <ThemeToggle />
          </div>
        </header>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
