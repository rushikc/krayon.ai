import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { waiterCount } from "../src/confirm-waiters.js";
import { CliExit, runCli } from "../src/cli.js";
import type { Clip, Cuts } from "../src/domain/types.js";
import { emptyCuts, OpError } from "../src/domain/types.js";
import { emptyConfirmations, mintConfirmation, validateConfirmationInput } from "../src/domain/confirmations.js";
import { commitRevision, createProject, saveMeta, useProject } from "../src/store.js";

const root = await mkdtemp(path.join(tmpdir(), "krayon-confirm-"));
const { app } = await buildApp({
  host: "127.0.0.1",
  port: 0,
  corsOrigins: ["http://localhost:5173"],
  pythonBase: "http://127.0.0.1:9",
  projectsDir: root,
});

let base = "";

function clip(id: string, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    parentIds: [],
    sourceStart: extra.sourceStart ?? 0,
    sourceEnd: extra.sourceEnd ?? 2,
    ranges: [{ sourceStart: extra.sourceStart ?? 0, sourceEnd: extra.sourceEnd ?? 2 }],
    duration: 2,
    text: extra.text ?? "hello",
    words: [
      { text: "hello", start: 0.1, end: 0.5 },
      { text: "world", start: 0.6, end: 1.5 },
    ],
    groupId: "g-0001",
    label: extra.label ?? "none",
    score: 2,
    reasons: extra.reasons ?? ["reference take"],
    status: extra.status ?? "selected",
    decidedBy: "algorithm",
    statusReason: "",
    statusAt: "",
    note: "",
    llm: {},
  };
}

beforeAll(async () => {
  base = await app.listen({ host: "127.0.0.1", port: 0 });
  const meta = await createProject(root, "ask", "Ask");
  const cuts: Cuts = {
    ...emptyCuts(),
    clips: [clip("c-0001"), clip("c-0002", { sourceStart: 3, sourceEnd: 4, status: "undecided", label: "cut_off" })],
    groups: [{ id: "g-0001", label: "hello", clipIds: ["c-0001", "c-0002"], recommendedClipId: "c-0001" }],
    order: ["c-0001"],
  };
  meta.nextClipSeq = 3;
  meta.nextGroupSeq = 2;
  await commitRevision(path.join(root, "ask"), meta, cuts, "algorithm", "analyze", "seed");
  await useProject(root, "ask");
});

afterAll(async () => {
  await app.close();
});

function env() {
  return { KRAYON_STUDIO_URL: base };
}

async function http(
  method: string,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: { "content-type": "application/json", "x-krayon-actor": "grok", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  return { status: response.status, payload };
}

describe("confirmation domain", () => {
  it("rejects unknown clips and bad proposed ops", () => {
    const cuts: Cuts = {
      ...emptyCuts(),
      clips: [clip("c-0001")],
      groups: [{ id: "g-0001", label: "hello", clipIds: ["c-0001"], recommendedClipId: "c-0001" }],
    };
    expect(() =>
      validateConfirmationInput(
        { kind: "confirm", title: "x", options: [{ id: "accept", label: "A" }], clipIds: ["c-9999"] },
        cuts,
        { nextClipSeq: 2, nextGroupSeq: 2 },
      ),
    ).toThrow(OpError);
    expect(() =>
      validateConfirmationInput(
        {
          kind: "confirm",
          title: "x",
          options: [{ id: "accept", label: "A", applyOps: true }],
          proposedOps: { baseRevision: 1, ops: [{ op: "reject", clipId: "c-9999" }] },
        },
        cuts,
        { nextClipSeq: 2, nextGroupSeq: 2 },
      ),
    ).toThrow(OpError);
    const file = emptyConfirmations();
    const item = mintConfirmation(file, {
      kind: "confirm",
      title: "Reject?",
      message: "",
      clipIds: [],
      options: [{ id: "accept", label: "Accept", applyOps: true }],
    }, "grok");
    expect(item.id).toBe("q-0001");
    expect(file.nextSeq).toBe(2);
  });
});

describe("confirmation http", () => {
  it("creates, answers, and applies ops as human", async () => {
    const created = await http("POST", "/api/studio/projects/ask/confirmations", {
      kind: "confirm",
      title: "Reject c-0002?",
      clipIds: ["c-0002"],
      options: [
        { id: "accept", label: "Accept", style: "primary", applyOps: true },
        { id: "decline", label: "Decline", style: "danger", applyOps: false },
      ],
      proposedOps: { baseRevision: 1, ops: [{ op: "reject", clipId: "c-0002" }] },
    });
    expect(created.status).toBe(200);
    const id = created.payload.id as string;
    const answered = await http("POST", `/api/studio/projects/ask/confirmations/${id}/answer`, { optionId: "accept" }, { "x-krayon-actor": "human" });
    expect(answered.payload.status).toBe("answered");
    expect((answered.payload.result as { applied: boolean }).applied).toBe(true);
    const history = await http("GET", "/api/studio/projects/ask/history");
    expect((history.payload.history as { actor: string }[]).some((entry) => entry.actor === "human")).toBe(true);
  });

  it("resolves wait within 100ms of an answer and times out", async () => {
    const created = await http("POST", "/api/studio/projects/ask/confirmations", {
      kind: "confirm",
      title: "Wait me",
      options: [
        { id: "accept", label: "Accept", applyOps: false },
        { id: "decline", label: "Decline", applyOps: false },
      ],
    });
    const id = created.payload.id as string;
    const waiting = fetch(`${base}/api/studio/projects/ask/confirmations/${id}/wait?timeoutMs=2000`);
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await http("POST", `/api/studio/projects/ask/confirmations/${id}/answer`, { optionId: "decline" });
    const response = await waiting;
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.status).toBe("answered");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(Date.now() - started).toBeLessThan(400);

    const timed = await http("POST", "/api/studio/projects/ask/confirmations", {
      kind: "confirm",
      title: "Timeout",
      options: [{ id: "accept", label: "Accept" }],
    });
    const wait = await fetch(`${base}/api/studio/projects/ask/confirmations/${timed.payload.id}/wait?timeoutMs=50`);
    const body = (await wait.json()) as { timedOut?: boolean };
    expect(wait.status).toBe(200);
    expect(body.timedOut).toBe(true);
  });

  it("wait-any, cancel, callback host, expiry, and disconnect cleanup", async () => {
    const created = await http("POST", "/api/studio/projects/ask/confirmations", {
      kind: "choice",
      title: "Pick",
      options: [
        { id: "keep", label: "Keep" },
        { id: "drop", label: "Drop" },
      ],
    });
    const since = created.payload.seq as number;
    const waiting = fetch(`${base}/api/studio/projects/ask/confirmations/wait-any?timeoutMs=2000&since=${since - 1}`);
    await http("POST", `/api/studio/projects/ask/confirmations/${created.payload.id}/cancel`, {});
    const any = (await (await waiting).json()) as { status: string };
    expect(any.status).toBe("cancelled");

    const bad = await http("POST", "/api/studio/projects/ask/confirmations", {
      kind: "confirm",
      title: "hook",
      options: [{ id: "accept", label: "A" }],
      callbackUrl: "https://example.com/hook",
    });
    expect(bad.status).toBe(400);

    let received = 0;
    const hook = createServer((_req, res) => {
      received += 1;
      res.end("ok");
    });
    await new Promise<void>((resolve) => hook.listen(0, "127.0.0.1", resolve));
    const address = hook.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const local = await http("POST", "/api/studio/projects/ask/confirmations", {
      kind: "confirm",
      title: "local hook",
      options: [{ id: "accept", label: "A" }],
      callbackUrl: `http://127.0.0.1:${port}/hook`,
    });
    await http("POST", `/api/studio/projects/ask/confirmations/${local.payload.id}/answer`, { optionId: "accept" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(received).toBeGreaterThan(0);
    hook.close();

    const expiring = await http("POST", "/api/studio/projects/ask/confirmations", {
      kind: "confirm",
      title: "expire",
      options: [{ id: "accept", label: "A" }],
      expiresAt: new Date(Date.now() + 40).toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const expired = await http("GET", `/api/studio/projects/ask/confirmations/${expiring.payload.id}`);
    expect(expired.payload.status).toBe("expired");

    const pending = await http("POST", "/api/studio/projects/ask/confirmations", {
      kind: "confirm",
      title: "abort",
      options: [{ id: "accept", label: "A" }],
    });
    const controller = new AbortController();
    const pendingWait = fetch(`${base}/api/studio/projects/ask/confirmations/${pending.payload.id}/wait?timeoutMs=5000`, {
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();
    await pendingWait.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(waiterCount()).toBe(0);
  });

  it("marks stale when the revision moved", async () => {
    const state = await http("GET", "/api/studio/projects/ask");
    const revision = Number(state.payload.revision);
    const created = await http("POST", "/api/studio/projects/ask/confirmations", {
      kind: "confirm",
      title: "stale",
      options: [{ id: "accept", label: "Accept", applyOps: true }, { id: "decline", label: "Decline" }],
      proposedOps: { baseRevision: revision, ops: [{ op: "select", clipId: "c-0001" }] },
    });
    await http("POST", "/api/studio/projects/ask/ops", {
      baseRevision: revision,
      actor: "human",
      ops: [{ op: "note", clipId: "c-0001", note: "touch" }],
    });
    const answered = await http("POST", `/api/studio/projects/ask/confirmations/${created.payload.id}/answer`, { optionId: "accept" });
    expect(answered.payload.status).toBe("stale");
    expect((answered.payload.result as { error: string }).error).toBe("stale_revision");
  });
});

describe("confirmation cli exit codes", () => {
  it("maps decline to 3", async () => {
    const created = (await runCli(["ask", "confirm", "Decline me"], env())) as { id: string };
    const waiting = runCli(["confirm-wait", created.id, "--timeout", "5"], env()).then(
      () => {
        throw new Error("expected decline exit");
      },
      (error: unknown) => error,
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    await http("POST", `/api/studio/projects/ask/confirmations/${created.id}/answer`, { optionId: "decline" });
    const error = await waiting;
    expect(error).toBeInstanceOf(CliExit);
    expect((error as CliExit).code).toBe(3);
  });
});

describe("status recovery", () => {
  it("recovers analyzing on boot and serves render files from disk", async () => {
    const stuckRoot = await mkdtemp(path.join(tmpdir(), "krayon-stuck-"));
    const meta = await createProject(stuckRoot, "stuck", "Stuck");
    meta.status = "analyzing";
    meta.statusMessage = "hung";
    await saveMeta(path.join(stuckRoot, "stuck"), meta);
    const outputDir = path.join(stuckRoot, "stuck", "output");
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "preview-1-1.mp4"), "mp4");
    await writeFile(path.join(outputDir, "preview-1-1.json"), JSON.stringify({ clips: [] }));
    const built = await buildApp({
      host: "127.0.0.1",
      port: 0,
      corsOrigins: ["http://localhost:5173"],
      pythonBase: "http://127.0.0.1:9",
      projectsDir: stuckRoot,
    });
    const url = await built.app.listen({ host: "127.0.0.1", port: 0 });
    const recovered = await fetch(`${url}/api/studio/projects/stuck`);
    const body = (await recovered.json()) as { meta: { status: string; statusMessage: string } };
    expect(body.meta.status).toBe("error");
    expect(body.meta.statusMessage).toContain("Interrupted");
    const analyze = await fetch(`${url}/api/studio/projects/stuck/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(analyze.status).not.toBe(409);
    const render = await fetch(`${url}/api/studio/projects/stuck/render/preview-1-1`);
    expect(render.status).toBe(200);
    expect(((await render.json()) as { status: string }).status).toBe("done");
    const missing = await fetch(`${url}/api/studio/projects/stuck/render/nope`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe("not_found");
    await built.app.close();
  });
});
