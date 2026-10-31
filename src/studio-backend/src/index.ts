import { mkdirSync } from "node:fs";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
mkdirSync(config.projectsDir, { recursive: true });
const { app } = await buildApp(config);

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`studio-backend listening on http://${config.host}:${config.port}`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
