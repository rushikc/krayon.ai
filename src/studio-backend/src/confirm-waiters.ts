import type { ConfirmationItem } from "./domain/confirmations.js";

type Waiter = {
  resolve: (value: ConfirmationItem | { status: "pending"; timedOut: true; id?: string; seq?: number }) => void;
  id: string | null;
  since: number;
};

const waiters = new Set<Waiter>();

export function waiterCount(): number {
  return waiters.size;
}

export function notifyConfirmation(item: ConfirmationItem): void {
  for (const waiter of [...waiters]) {
    if (waiter.id && waiter.id !== item.id) continue;
    if (!waiter.id && item.seq <= waiter.since) continue;
    waiters.delete(waiter);
    waiter.resolve(item);
  }
}

export function waitForConfirmation(options: {
  id?: string;
  since?: number;
  timeoutMs: number;
  onAbort: (listener: () => void) => void;
}): Promise<ConfirmationItem | { status: "pending"; timedOut: true; id?: string; seq?: number }> {
  const timeoutMs = Math.min(Math.max(0, options.timeoutMs), 780_000);
  return new Promise((resolve) => {
    const waiter: Waiter = {
      id: options.id ?? null,
      since: options.since ?? 0,
      resolve,
    };
    const timer = setTimeout(() => {
      waiters.delete(waiter);
      resolve({ status: "pending", timedOut: true, id: options.id, seq: options.since });
    }, timeoutMs);
    const original = waiter.resolve;
    waiter.resolve = (value) => {
      clearTimeout(timer);
      original(value);
    };
    waiters.add(waiter);
    options.onAbort(() => {
      clearTimeout(timer);
      waiters.delete(waiter);
    });
  });
}
