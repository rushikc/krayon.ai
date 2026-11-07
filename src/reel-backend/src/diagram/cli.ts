import { loadConfig } from "../config.js";
import { createLogger } from "../logging.js";
import { hasError } from "./issues.js";
import { listReelArgs, reelPaths } from "./paths.js";
import { runBuild, runValidate, type PipelineResult } from "./pipeline.js";

function usage(): string {
  return "usage: diagram <validate|build|list> [reel-id]";
}

function printJson(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function exitCode(result: PipelineResult): number {
  if (result.ok) return 0;
  if (result.envError) return 3;
  return 2;
}

export async function runCli(argv: string[], env = process.env): Promise<{ code: number; payload: unknown }> {
  const command = argv[0];
  const reelArg = argv[1];
  const config = loadConfig();
  if (env.KRAYON_CHROME_PATH) config.diagram.chromePath = env.KRAYON_CHROME_PATH;
  if (env.KRAYON_DIAGRAMS_DIR) config.diagram.diagramsDir = env.KRAYON_DIAGRAMS_DIR;
  const log = createLogger(config, { console: process.stderr });

  if (command === "list") {
    const reels = listReelArgs(config.diagram.diagramsDir);
    for (const id of reels) process.stderr.write(`${id}\n`);
    const payload = { ok: true, reelId: null, issues: [], statusPath: null, reels };
    return { code: 0, payload };
  }

  if (command !== "validate" && command !== "build") {
    const payload = {
      ok: false,
      reelId: null,
      issues: [{ code: "SCHEMA_INVALID", severity: "error", message: usage() }],
      statusPath: null,
    };
    return { code: 2, payload };
  }

  if (!reelArg) {
    const payload = {
      ok: false,
      reelId: null,
      issues: [{ code: "SCHEMA_INVALID", severity: "error", message: usage() }],
      statusPath: null,
    };
    return { code: 2, payload };
  }

  const result = command === "validate" ? await runValidate(config, reelArg, log) : await runBuild(config, reelArg, log);
  const payload = {
    ok: result.ok && !hasError(result.issues),
    reelId: result.reelId,
    issues: result.issues,
    statusPath: result.statusPath ? reelPaths(config.diagram.diagramsDir, reelArg).status : result.statusPath,
  };
  return { code: exitCode({ ...result, ok: payload.ok }), payload };
}

const invoked = process.argv[1]?.includes("diagram/cli");
if (invoked) {
  const result = await runCli(process.argv.slice(2));
  printJson(result.payload);
  process.exit(result.code);
}
