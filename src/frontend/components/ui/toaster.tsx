import { Check } from "lucide-react";

import { useToastStore } from "@/stores/toast-store";

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed top-4 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      {toasts.map((item) => (
        <div
          key={item.id}
          role="status"
          className="flex items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm animate-in fade-in-0 slide-in-from-top-2"
        >
          <Check className="size-4 shrink-0 text-green-600 dark:text-green-500" />
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}
