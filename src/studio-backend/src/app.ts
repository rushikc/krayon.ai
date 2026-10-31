import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import type { StudioConfig } from "./config.js";
import { EventHub } from "./events.js";
import { errorBody, registerRoutes } from "./routes.js";
import { recoverStuckProjects } from "./store.js";

export async function buildApp(config: StudioConfig, hub = new EventHub()) {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cors, { origin: config.corsOrigins });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 * 1024 } });
  await recoverStuckProjects(config.projectsDir);
  registerRoutes(app, { config, hub });
  app.setErrorHandler((error, _request, reply) => {
    const known = errorBody(error);
    if (known) {
      reply.code(known.status).send(known.body);
      return;
    }
    const message = error instanceof Error ? error.message : "Internal error";
    reply.code(500).send({ error: "internal", message });
  });
  return { app, hub };
}
