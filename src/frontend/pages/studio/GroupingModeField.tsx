import { Switch } from "@/components/ui/switch";
import type { GroupingMode } from "@/lib/api/studio-client";
import { studioCopy } from "@/lib/studio-copy";
import { cn } from "@/lib/utils";

export function GroupingModeField({
  value,
  onChange,
  testId,
  className,
}: {
  value: GroupingMode;
  onChange: (next: GroupingMode) => void;
  testId: string;
  className?: string;
}) {
  const anywhere = value === "global";
  return (
    <div className={cn("space-y-2", className)} data-testid={testId}>
      <p className="text-xs text-muted-foreground">{studioCopy.grouping}</p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm leading-5">{studioCopy.groupingAnywhere}</span>
        <Switch
          checked={anywhere}
          aria-label={studioCopy.groupingAnywhere}
          onCheckedChange={(checked) => onChange(checked ? "global" : "timeline")}
        />
      </div>
      <p className="text-xs text-muted-foreground">{studioCopy.groupingHint}</p>
    </div>
  );
}
