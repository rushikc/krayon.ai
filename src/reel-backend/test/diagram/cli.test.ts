import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/diagram/cli.js";
import { uberSkeleton } from "./fixtures.js";

function tmpEnv(dir: string, extra: Record<string, string> = {}) {
  return { ...process.env, KRAYON_DIAGRAMS_DIR: dir, ...extra };
}

describe("diagram cli", () => {
  it("exits 2 when the reel is missing", async () => {
    const dir = path.join(os.tmpdir(), `krayon-diagram-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const result = await runCli(["validate", "nope"], tmpEnv(dir));
    expect(result.code).toBe(2);
    const payload = result.payload as { ok: boolean; issues: { code: string }[] };
    expect(payload.ok).toBe(false);
    expect(payload.issues.some((item) => item.code === "REEL_NOT_FOUND")).toBe(true);
  });

  it("exits 0 on a valid skeleton", async () => {
    const dir = path.join(os.tmpdir(), `krayon-diagram-${crypto.randomUUID()}`);
    const reel = path.join(dir, "uber-ttl");
    mkdirSync(reel, { recursive: true });
    writeFileSync(path.join(reel, "diagram.skeleton.json"), JSON.stringify(uberSkeleton()));
    const result = await runCli(["validate", "uber-ttl"], tmpEnv(dir));
    expect(result.code).toBe(0);
    expect((result.payload as { ok: boolean }).ok).toBe(true);
  });

  it("exits 3 when Chrome is missing on build", async () => {
    const dir = path.join(os.tmpdir(), `krayon-diagram-${crypto.randomUUID()}`);
    const reel = path.join(dir, "uber-ttl");
    mkdirSync(reel, { recursive: true });
    writeFileSync(path.join(reel, "diagram.skeleton.json"), JSON.stringify(uberSkeleton()));
    const result = await runCli(
      ["build", "uber-ttl"],
      tmpEnv(dir, { KRAYON_CHROME_PATH: path.join(dir, "no-chrome") }),
    );
    expect(result.code).toBe(3);
    const payload = result.payload as { issues: { code: string }[] };
    expect(payload.issues.some((item) => item.code === "CHROME_NOT_FOUND")).toBe(true);
  });

  it("lists reels", async () => {
    const dir = path.join(os.tmpdir(), `krayon-diagram-${crypto.randomUUID()}`);
    const reel = path.join(dir, "uber-ttl");
    mkdirSync(reel, { recursive: true });
    writeFileSync(path.join(reel, "diagram.skeleton.json"), JSON.stringify(uberSkeleton()));
    const result = await runCli(["list"], tmpEnv(dir));
    expect(result.code).toBe(0);
    expect((result.payload as { reels: string[] }).reels).toContain("uber-ttl");
  });
});
