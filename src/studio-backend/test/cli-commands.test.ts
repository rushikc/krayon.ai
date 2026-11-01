import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliExit, runCli } from "../src/cli.js";
import { clip, listenStudio, seedProject, type PythonState } from "./helpers.js";

let base = "";
let root = "";
let state: PythonState;
let close: () => Promise<void>;

beforeAll(async () => {
  const studio = await listenStudio();
  base = studio.base;
  root = studio.root;
  state = studio.state;
  close = studio.close;
  await seedProject(root, "cli-demo", [
    clip({ id: "c-0001", text: "alpha beta", sourceStart: 0, sourceEnd: 2, status: "selected" }),
    clip({ id: "c-0002", text: "gamma delta", sourceStart: 2.2, sourceEnd: 4, status: "undecided", groupId: "g-0002" }),
  ]);
});

afterAll(async () => {
  await close();
});

function env(extra: Record<string, string> = {}) {
  return { KRAYON_STUDIO_URL: base, ...extra };
}

async function exitOf(argv: string[], extra: Record<string, string> = {}) {
  try {
    await runCli(argv, env(extra));
    return 0;
  } catch (error) {
    if (error instanceof CliExit) return error.code;
    throw error;
  }
}

describe("cli commands", () => {
  it("returns 1 for an unknown command and a missing argument", async () => {
    expect(await exitOf(["nope"])).toBe(1);
    expect(await exitOf(["merge", "c-0001"])).toBe(1);
    expect(await exitOf(["settings", "set"])).toBe(1);
  });

  it("lists, creates, switches, and prints pretty status", async () => {
    const listed = (await runCli(["projects", "list"], env())) as { projects: { slug: string }[] };
    expect(listed.projects.map((item) => item.slug)).toContain("cli-demo");
    const created = (await runCli(["projects", "new", "Other", "--slug", "cli-other"], env())) as { slug: string };
    expect(created.slug).toBe("cli-other");
    const used = (await runCli(["projects", "use", "cli-demo"], env())) as { current: string };
    expect(used.current).toBe("cli-demo");
    const pretty = await runCli(["status", "--pretty", "--project", "cli-demo"], env());
    expect(pretty).toMatchObject({ meta: { slug: "cli-demo" } });
  });

  it("imports, edits, and reads the project", async () => {
    const source = path.join(root, "cli-demo", "source.txt");
    await writeFile(source, "video");
    const imported = await runCli(["import", source, "--project", "cli-demo"], env());
    expect(imported).toMatchObject({ sourcePath: source });
    await runCli(["reject", "c-0002", "--reason", "aside", "--project", "cli-demo"], env());
    await runCli(["select", "c-0002", "--project", "cli-demo"], env());
    await runCli(["annotate", "c-0001", "--json", "{\"verdict\":\"keep\"}", "--project", "cli-demo"], env());
    await runCli(["settings", "set", "pad", "0.08", "--project", "cli-demo"], env());
    const settings = (await runCli(["settings", "--project", "cli-demo"], env())) as { settings: { pad: number } };
    expect(settings.settings.pad).toBe(0.08);
    const scriptFile = path.join(root, "cli-demo", "incoming.txt");
    await writeFile(scriptFile, "alpha beta\n");
    await runCli(["script", "set", "--file", scriptFile, "--project", "cli-demo"], env());
    const shown = (await runCli(["script", "show", "--project", "cli-demo"], env())) as { scriptLineCount: number };
    expect(shown.scriptLineCount).toBe(1);
    await runCli(["split", "c-0001", "--at", "1", "--sample-accurate", "--project", "cli-demo"], env());
    const status = (await runCli(["status", "--project", "cli-demo"], env())) as { clips: { id: string; sourceEnd: number; parentIds: string[] }[] };
    const right = status.clips.find((item) => item.parentIds.includes("c-0001") && item.sourceEnd > 1)!;
    const left = status.clips.find((item) => item.parentIds.includes("c-0001") && item.sourceEnd <= 1)!;
    await runCli(["merge", left.id, right.id, "--project", "cli-demo"], env());
    await runCli(["trim", "c-0002", "--start", "2.4", "--end", "3.6", "--sample-accurate", "--project", "cli-demo"], env());
    const ordered = (await runCli(["order", "--project", "cli-demo"], env())) as { order: string[] };
    expect(ordered.order.length).toBeGreaterThan(0);
    await runCli(["undo", "--project", "cli-demo"], env());
    await runCli(["redo", "--project", "cli-demo"], env());
    const history = (await runCli(["history", "--project", "cli-demo"], env())) as { history: unknown[] };
    expect(history.history.length).toBeGreaterThan(1);
    const lint = await runCli(["lint", "--project", "cli-demo"], env());
    expect(lint).toHaveProperty("warnings");
    const info = (await runCli(["play-info", "c-0002", "--project", "cli-demo"], env())) as { audioUrl: string };
    expect(info.audioUrl).toContain("/clips/c-0002/audio.wav");
    const clip = (await runCli(["clip", "c-0002", "--project", "cli-demo"], env())) as { clip: { id: string } };
    expect(clip.clip.id).toBe("c-0002");
    const listed = (await runCli(["clips", "--project", "cli-demo"], env())) as { clips: unknown[] };
    expect(listed.clips.length).toBeGreaterThan(0);
  });

  it("reanalyzes, renders, cancels, and resets status", async () => {
    state.mode = "ok";
    await runCli(["reanalyze", "c-0002", "--mode", "regroup", "--project", "cli-demo"], env());
    const after = (await runCli(["status", "--project", "cli-demo"], env())) as { clips: { id: string }[] };
    await runCli(["select", after.clips[0]!.id, "--project", "cli-demo"], env());
    state.mode = "hang";
    const started = (await runCli(["render", "--preview", "--project", "cli-demo"], env())) as { renderId: string };
    const cancelled = await runCli(["render-cancel", started.renderId, "--project", "cli-demo"], env());
    expect(cancelled).toMatchObject({ status: "cancelled" });
    state.release?.();
    state.mode = "ok";
    const reset = (await runCli(["reset-status", "--project", "cli-demo"], env())) as { status: string };
    expect(reset.status).not.toBe("rendering");
  });

  it("asks, lists confirmations, and cancels", async () => {
    const choice = (await runCli(
      ["ask", "choice", "Which take?", "--option", "keep=Keep", "--option", "drop=Drop", "--project", "cli-demo"],
      env(),
    )) as { id: string; kind: string };
    expect(choice.kind).toBe("choice");
    const listed = (await runCli(["confirmations", "--status", "pending", "--project", "cli-demo"], env())) as { items: { id: string }[] };
    expect(listed.items.some((item) => item.id === choice.id)).toBe(true);
    const one = (await runCli(["confirmation", choice.id, "--project", "cli-demo"], env())) as { id: string };
    expect(one.id).toBe(choice.id);
    const cancelled = (await runCli(["cancel-ask", choice.id, "--project", "cli-demo"], env())) as { status: string };
    expect(cancelled.status).toBe("cancelled");
    expect(await exitOf(["confirm-wait"], { } )).toBe(1);
  });

  it("exits 2 when the server reports a conflict", async () => {
    const status = (await runCli(["status", "--project", "cli-demo"], env())) as { revision: number };
    const code = await exitOf([
      "op",
      JSON.stringify({ baseRevision: status.revision - 1, ops: [{ op: "note", clipId: "c-0002", note: "stale" }] }),
      "--project",
      "cli-demo",
    ]);
    expect(code).toBe(2);
    expect(await exitOf(["status", "--project", "cli-demo"])).toBe(0);
  });
});
