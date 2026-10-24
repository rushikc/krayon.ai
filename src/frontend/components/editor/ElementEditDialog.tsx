import { useEffect, useMemo, useState } from "react";

import {
  ElementConfigForm,
  ElementGlyph,
  elementConfigErrors,
} from "@/components/canvas/ElementConfigForm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCanvasStore } from "@/stores/canvas-store";
import {
  getElementLabel,
  isBoxNode,
  type CanvasElement,
} from "@/types/canvas";

/**
 * Edit-element modal. Cancel and Escape discard the draft.
 * Outside click closes only when the draft is clean; dirty drafts stay open.
 */
function cloneElement(element: CanvasElement): CanvasElement {
  return structuredClone(element);
}

function isDirty(original: CanvasElement, draft: CanvasElement): boolean {
  return JSON.stringify(original) !== JSON.stringify(draft);
}

export function ElementEditDialog({
  elementId,
  onClose,
}: {
  elementId: string | null;
  onClose: () => void;
}) {
  const elements = useCanvasStore((state) => state.elements);
  const duration = useCanvasStore((state) => state.duration);
  const source = elements.find((element) => element.id === elementId) ?? null;
  const boxIds = elements.filter(isBoxNode).map((box) => box.id);
  const [draft, setDraft] = useState<CanvasElement | null>(
    source ? cloneElement(source) : null,
  );

  useEffect(() => {
    if (!elementId) {
      setDraft(null);
      return;
    }
    const current = useCanvasStore
      .getState()
      .elements.find((element) => element.id === elementId);
    setDraft(current ? cloneElement(current) : null);
  }, [elementId]);

  const dirty = useMemo(() => {
    if (!source || !draft) {
      return false;
    }
    return isDirty(source, draft);
  }, [draft, source]);

  const errors = draft ? elementConfigErrors(draft, boxIds) : [];
  const open = Boolean(elementId && source && draft);

  function requestClose() {
    onClose();
  }

  function onOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      return;
    }
    if (dirty) {
      return;
    }
    requestClose();
  }

  function onSave() {
    if (!draft || errors.length > 0) {
      return;
    }
    useCanvasStore.getState().updateElement(draft.id, draft);
    onClose();
  }

  function onDelete() {
    if (!draft) {
      return;
    }
    const label = getElementLabel(draft);
    if (!window.confirm(`Delete ${label}?`)) {
      return;
    }
    const store = useCanvasStore.getState();
    store.selectElement(draft.id);
    store.deleteSelectedElement();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="flex max-h-[85vh] max-w-[520px] flex-col gap-0 p-0">
          {draft ? (
            <>
              <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-3">
                <ElementGlyph element={draft} />
                <div className="min-w-0">
                  <DialogTitle className="truncate">
                    {getElementLabel(draft)}
                  </DialogTitle>
                  <DialogDescription className="truncate font-mono">
                    {draft.type} · {draft.id}
                  </DialogDescription>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ElementConfigForm
                  element={draft}
                  boxIds={boxIds}
                  duration={duration}
                  onChange={setDraft}
                />
                {errors.length > 0 ? (
                  <ul className="space-y-1 px-4 pb-3 text-xs text-destructive">
                    {errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={onDelete}
                >
                  Delete element
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={requestClose}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={errors.length > 0}
                    onClick={onSave}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
