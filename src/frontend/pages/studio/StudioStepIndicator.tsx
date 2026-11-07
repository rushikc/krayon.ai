import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { studioCopy } from "@/lib/studio-copy";
import { cn } from "@/lib/utils";

export const STUDIO_STEPS = [
  { id: "audio", label: studioCopy.stepAudio },
  { id: "video", label: studioCopy.stepVideo },
] as const;

export function StudioStepIndicator({
  activeId = "audio",
  videoEnabled = false,
  onAudioClick,
  onVideoClick,
}: {
  activeId?: string;
  videoEnabled?: boolean;
  onAudioClick?: () => void;
  onVideoClick?: () => void;
}) {
  return (
    <TooltipProvider>
      <ol className="ml-4 flex items-center gap-2 text-xs" data-testid="studio-steps">
        {STUDIO_STEPS.map((step) => {
          const active = step.id === activeId;
          const enabled = step.id === "audio" || videoEnabled;
          const onClick = step.id === "audio" ? onAudioClick : onVideoClick;
          const chip = (
            <button
              type="button"
              disabled={!enabled}
              onClick={enabled ? onClick : undefined}
              className={cn(
                "rounded-md border px-2 py-0.5",
                active ? "border-primary/40 bg-primary/15 text-foreground" : "border-border text-muted-foreground",
                !enabled && "cursor-not-allowed opacity-50",
                enabled && onClick && "cursor-pointer hover:border-foreground/40",
              )}
            >
              {step.label}
            </button>
          );
          if (enabled) {
            return <li key={step.id}>{chip}</li>;
          }
          return (
            <li key={step.id}>
              <Tooltip>
                <TooltipTrigger render={<span className="cursor-not-allowed" title={studioCopy.comingSoon} />}>
                  {chip}
                </TooltipTrigger>
                <TooltipContent>{studioCopy.comingSoon}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ol>
    </TooltipProvider>
  );
}
