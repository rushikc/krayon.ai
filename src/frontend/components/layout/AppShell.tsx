import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { ThemeToggle } from "@/components/layout/ThemeToggle";

interface AppShellProps {
  children: ReactNode;
  showBack?: boolean;
  backTo?: string;
  backLabel?: string;
  subtitle?: string;
  hideHeader?: boolean;
  afterTitle?: ReactNode;
  actions?: ReactNode;
}

export function AppShell({
  children,
  showBack = false,
  backTo = "/",
  backLabel = "Back to library",
  subtitle = "local video editor",
  hideHeader = false,
  afterTitle,
  actions,
}: AppShellProps) {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground selection:bg-primary/30">
      {hideHeader ? null : (
        <header className="flex h-11 shrink-0 items-center border-b border-border px-4">
          <div className="flex min-w-0 items-center">
            {showBack && (
              <Link
                to={backTo}
                className="mr-3 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" />
                {backLabel}
              </Link>
            )}
            <h1 className="text-sm font-semibold tracking-tight">Krayon</h1>
            <span className="ml-2 text-xs text-muted-foreground">{subtitle}</span>
            {afterTitle}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <ThemeToggle />
          </div>
        </header>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
