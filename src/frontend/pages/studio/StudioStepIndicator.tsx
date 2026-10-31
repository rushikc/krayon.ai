import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { studioCopy } from "@/lib/studio-copy";
import { cn } from "@/lib/utils";

export const STUDIO_STEPS = [
  { id: "audio", label: studioCopy.stepAudio, enabled: true },
  { id: "video", label: studioCopy.stepVideo, enabled: false, tooltip: studioCopy.comingSoon },
] as const;

export function StudioStepIndicator({ activeId = "audio" }: { activeId?: string }) {
  return (
    <TooltipProvider>
      <ol className="ml-4 flex items-center gap-2 text-xs" data-testid="studio-steps">
        {STUDIO_STEPS.map((step) => {
          const active = step.id === activeId;
          const chip = (
            <span
              className={cn(
                "rounded-md border px-2 py-0.5",
                active ? "border-primary/40 bg-primary/15 text-foreground" : "border-border text-muted-foreground",
                !step.enabled && "opacity-50",
              )}
            >
              {step.label}
            </span>
          );
          if (step.enabled) {
            return (
              <li key={step.id}>{chip}</li>
            );
          }
          return (
            <li key={step.id}>
              <Tooltip>
                <TooltipTrigger render={<span className="cursor-not-allowed" title={step.tooltip} />}>
                  {chip}
                </TooltipTrigger>
                <TooltipContent>{step.tooltip}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ol>
    </TooltipProvider>
  );
}
