import type { ReelEvent } from "./apiTypes.js";

type Listener = (seq: number, event: ReelEvent) => void;

type JobBus = {
  seq: number;
  history: Array<{ seq: number; event: ReelEvent }>;
  listeners: Set<Listener>;
};

export class EventHub {
  private readonly jobs = new Map<string, JobBus>();

  private bus(jobId: string): JobBus {
    let bus = this.jobs.get(jobId);
    if (!bus) {
      bus = { seq: 0, history: [], listeners: new Set() };
      this.jobs.set(jobId, bus);
    }
    return bus;
  }

  emit(jobId: string, event: ReelEvent): number {
    const bus = this.bus(jobId);
    bus.seq += 1;
    const seq = bus.seq;
    bus.history.push({ seq, event });
    if (bus.history.length > 200) bus.history.shift();
    for (const listener of bus.listeners) listener(seq, event);
    return seq;
  }

  subscribe(jobId: string, lastId: number, listener: Listener): () => void {
    const bus = this.bus(jobId);
    for (const item of bus.history) {
      if (item.seq > lastId) listener(item.seq, item.event);
    }
    bus.listeners.add(listener);
    return () => {
      bus.listeners.delete(listener);
    };
  }
}
