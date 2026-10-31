import { EventEmitter } from "node:events";

export type StudioEvent = {
  type:
    | "progress"
    | "revision"
    | "render"
    | "status"
    | "confirmation_created"
    | "confirmation_resolved"
    | "confirmation_cancelled";
  phase?: string;
  message?: string;
  ratio?: number;
  revision?: number;
  actor?: string;
  label?: string;
  summary?: string;
  renderId?: string;
  status?: string;
  outputName?: string;
  id?: string;
  optionId?: string;
  result?: unknown;
};

export class EventHub {
  private readonly emitters = new Map<string, EventEmitter>();

  private emitter(slug: string): EventEmitter {
    let emitter = this.emitters.get(slug);
    if (!emitter) {
      emitter = new EventEmitter();
      emitter.setMaxListeners(50);
      this.emitters.set(slug, emitter);
    }
    return emitter;
  }

  publish(slug: string, event: StudioEvent): void {
    this.emitter(slug).emit("event", event);
  }

  subscribe(slug: string, listener: (event: StudioEvent) => void): () => void {
    const emitter = this.emitter(slug);
    emitter.on("event", listener);
    return () => emitter.off("event", listener);
  }
}
