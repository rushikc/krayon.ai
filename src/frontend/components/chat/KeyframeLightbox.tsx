import { useEffect } from "react";

import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { RoundKeyframe } from "@/types/reel-pipeline";

export function KeyframeLightbox({
  frames,
  index,
  onIndexChange,
  onClose,
}: {
  frames: RoundKeyframe[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const open = index !== null;
  const frame = index !== null ? frames[index] : undefined;

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight" && index !== null) {
        onIndexChange(Math.min(frames.length - 1, index + 1));
      }
      if (event.key === "ArrowLeft" && index !== null) {
        onIndexChange(Math.max(0, index - 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frames.length, index, onIndexChange, open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="flex max-w-lg flex-col gap-3">
          <DialogTitle>
            Keyframe {frame ? frame.index + 1 : ""} · {frame ? `${frame.time.toFixed(1)}s` : ""}
          </DialogTitle>
          {frame ? (
            <img
              src={frame.url}
              alt={`Keyframe at ${frame.time.toFixed(1)} seconds`}
              className="mx-auto aspect-[9/16] h-[min(70vh,28rem)] rounded-md border border-border object-cover"
            />
          ) : null}
          <div className="flex justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={index === null || index <= 0}
              onClick={() => index !== null && onIndexChange(index - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={index === null || index >= frames.length - 1}
              onClick={() => index !== null && onIndexChange(index + 1)}
            >
              Next
            </Button>
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
