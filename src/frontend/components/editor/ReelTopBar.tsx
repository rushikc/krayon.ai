import { ArrowLeft, Download } from "lucide-react";
import { Link } from "react-router-dom";

import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ReelTopBar({
  projectName,
  onProjectNameChange,
  exporting,
  onExport,
}: {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  exporting: boolean;
  onExport: () => void;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-card px-3">
      <Link
        to="/"
        aria-label="Back to home"
        className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Home
      </Link>
      <Input
        id="project-name"
        aria-label="Project name"
        placeholder="krayon-reel"
        value={projectName}
        onValueChange={onProjectNameChange}
        className="h-8 max-w-xs min-w-0 border-transparent bg-transparent px-2 text-sm font-semibold tracking-tight shadow-none hover:border-border focus-visible:border-ring"
      />
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <Button
          type="button"
          disabled={exporting}
          onClick={onExport}
          aria-label="Export MP4"
        >
          <Download />
          Export
        </Button>
      </div>
    </header>
  );
}
