import { mkdirSync } from "node:fs";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createGeminiClient } from "./gemini.js";
import { createLogger } from "./logging.js";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
mkdirSync(config.logDir, { recursive: true });
const log = createLogger(config);
const client = createGeminiClient(log);

const { app } = await buildApp({ config, log, client });

try {
  await app.listen({ host: config.host, port: config.port });
  log.info(`reel-backend listening on http://${config.host}:${config.port}`);
} catch (error) {
  log.error("Failed to listen", {}, error);
  process.exit(1);
}
