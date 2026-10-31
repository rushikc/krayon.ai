import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  clearGeminiApiKey,
  getGeminiApiKey,
  maskGeminiApiKey,
  setGeminiApiKey,
} from "@/lib/gemini-key";

export function GeminiKeyDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [value, setValue] = useState("");
  const saved = getGeminiApiKey();
  const masked = maskGeminiApiKey(saved);

  useEffect(() => {
    if (open) {
      setValue("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="flex max-w-md flex-col gap-3">
          <DialogTitle>Gemini API key</DialogTitle>
          <DialogDescription>
            Stored only in this browser as a first-party cookie and sent only to
            the local reel backend. It is never written to disk on the server.
          </DialogDescription>
          {masked ? (
            <p className="font-mono text-xs text-muted-foreground">
              Saved key {masked}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No key saved yet.</p>
          )}
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label="Gemini API key"
            placeholder="Paste your Google AI Studio key"
            value={value}
            onValueChange={setValue}
          />
          <a
            className="text-xs text-primary underline-offset-4 hover:underline"
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
          >
            Get a key from Google AI Studio
          </a>
          <div className="flex justify-end gap-2">
            {saved ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  clearGeminiApiKey();
                  setValue("");
                  onOpenChange(false);
                }}
              >
                Remove
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={() => {
                if (!value.trim()) {
                  return;
                }
                setGeminiApiKey(value);
                setValue("");
                onOpenChange(false);
                onSaved?.();
              }}
            >
              Save
            </Button>
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
