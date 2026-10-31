import cors from "@fastify/cors";
import Fastify from "fastify";
import type { ReelConfig } from "./config.js";
import { EventHub } from "./events.js";
import type { GeminiClient } from "./gemini.js";
import { JobRunner } from "./jobs.js";
import { type Logger, registerRequestLogging } from "./logging.js";
import { registerRoutes } from "./routes.js";
import { ReelStore } from "./store.js";

export type AppDeps = {
  config: ReelConfig;
  log: Logger;
  client: GeminiClient;
  store?: ReelStore;
  hub?: EventHub;
};

export async function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cors, {
    origin: deps.config.corsOrigins,
  });
  registerRequestLogging(app, deps.log, deps.config);
  const store = deps.store ?? new ReelStore(deps.config);
  const hub = deps.hub ?? new EventHub();
  const runner = new JobRunner(store, hub, deps.client, deps.config, deps.log);
  registerRoutes(app, { store, runner, hub, config: deps.config });
  app.addHook("onClose", async () => {
    store.close();
  });
  return { app, store, hub, runner };
}
