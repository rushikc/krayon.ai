export class CliExit extends Error {
  pretty: boolean;

  constructor(
    readonly code: number,
    readonly payload: unknown,
    pretty = false,
  ) {
    super(typeof payload === "string" ? payload : "cli exit");
    this.pretty = pretty;
  }
}

type Flags = { positionals: string[]; map: Map<string, string | true> };

function parseArgv(argv: string[]): Flags {
  const positionals: string[] = [];
  const map = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next == null || next.startsWith("--")) map.set(key, true);
    else {
      map.set(key, next);
      index += 1;
    }
  }
  return { positionals, map };
}

function flag(flags: Flags, name: string): string | undefined {
  const value = flags.map.get(name);
  return typeof value === "string" ? value : undefined;
}

async function request(
  base: string,
  actor: string,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-krayon-actor": actor,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new CliExit(response.status === 409 ? 2 : 1, payload, false);
  return payload;
}

async function currentSlug(base: string, actor: string, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const listed = (await request(base, actor, "GET", "/api/studio/projects")) as { current: string | null };
  if (!listed.current) {
    throw new CliExit(1, { error: "validation", message: "No current project. Run: krayon projects use <slug>" }, false);
  }
  return listed.current;
}

async function revisionOf(base: string, actor: string, slug: string): Promise<number> {
  const state = (await request(base, actor, "GET", `/api/studio/projects/${slug}`)) as { revision: number };
  return state.revision;
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env, stdin = ""): Promise<unknown> {
  const flags = parseArgv(argv);
  const pretty = flags.map.has("pretty");
  const actor = flag(flags, "actor") ?? "grok";
  const base = env.KRAYON_STUDIO_URL ?? "http://127.0.0.1:8789";
  const [command, sub, ...rest] = flags.positionals;
  const projectFlag = flag(flags, "project");

  const finish = async (pathname: string, method = "GET", body?: unknown) =>
    request(base, actor, method, pathname, body);

  try {
    if (command === "schema") return finish("/api/studio/schema");
    if (command === "projects" && sub === "list") return finish("/api/studio/projects");
    if (command === "projects" && sub === "new") {
      return finish("/api/studio/projects", "POST", { title: rest[0] ?? flag(flags, "title") ?? "Untitled", slug: flag(flags, "slug") });
    }
    if (command === "projects" && sub === "use") {
      if (!rest[0]) throw new CliExit(1, { error: "validation", message: "projects use <slug>" }, pretty);
      return finish("/api/studio/projects/use", "POST", { slug: rest[0] });
    }

    const slug = await currentSlug(base, actor, projectFlag);
    const project = `/api/studio/projects/${slug}`;

    if (command === "status") return finish(project);
    if (command === "import") {
      const source = rest[0] ?? sub;
      if (!source) throw new CliExit(1, { error: "validation", message: "import <video>" }, pretty);
      return finish(`${project}/import`, "POST", { path: source });
    }
    if (command === "clips") {
      const params = new URLSearchParams();
      for (const key of ["group", "label", "status"] as const) {
        const value = flag(flags, key);
        if (value) params.set(key, value);
      }
      const query = params.size ? `?${params}` : "";
      return finish(`${project}/clips${query}`);
    }
    if (command === "clip") {
      const id = sub;
      if (!id) throw new CliExit(1, { error: "validation", message: "clip <id>" }, pretty);
      return finish(`${project}/clips/${id}`);
    }
    if (command === "play-info") {
      const id = sub;
      if (!id) throw new CliExit(1, { error: "validation", message: "play-info <id>" }, pretty);
      const pad = flag(flags, "pad") ?? "0.5";
      const audioUrl = `${base}${project}/clips/${id}/audio.wav?pad=${pad}`;
      return {
        id,
        pad: Number(pad),
        audioUrl,
        hint: `curl -fsSL '${audioUrl}' -o /tmp/${id}.wav && afplay /tmp/${id}.wav`,
      };
    }
    if (command === "op") {
      const raw = flag(flags, "file")
        ? await (await import("node:fs/promises")).readFile(flag(flags, "file")!, "utf8")
        : (sub && sub !== "--" ? sub : stdin);
      if (!raw?.trim()) throw new CliExit(1, { error: "validation", message: "op '<json>' or --file or stdin" }, pretty);
      const parsed = JSON.parse(raw) as { ops?: unknown[]; baseRevision?: number };
      const ops = Array.isArray(parsed) ? parsed : (parsed.ops ?? [parsed]);
      const baseRevision = parsed.baseRevision ?? (await revisionOf(base, actor, slug));
      return finish(`${project}/ops`, "POST", { baseRevision, actor, ops, label: flag(flags, "label") });
    }
    if (command === "select" || command === "reject") {
      const ids = [sub, ...rest].filter(Boolean);
      if (ids.length === 0) throw new CliExit(1, { error: "validation", message: `${command} <id...>` }, pretty);
      const baseRevision = await revisionOf(base, actor, slug);
      return finish(`${project}/ops`, "POST", {
        baseRevision,
        actor,
        label: command,
        ops: ids.map((clipId) => ({ op: command, clipId })),
      });
    }
    if (command === "split") {
      const id = sub;
      if (!id) throw new CliExit(1, { error: "validation", message: "split <id> --at <seconds>" }, pretty);
      const baseRevision = await revisionOf(base, actor, slug);
      const op: Record<string, unknown> = { op: "split", clipId: id };
      if (flag(flags, "at")) op.at = Number(flag(flags, "at"));
      if (flag(flags, "word")) op.wordIndex = Number(flag(flags, "word"));
      if (flags.map.has("sample-accurate")) op.sampleAccurate = true;
      return finish(`${project}/ops`, "POST", { baseRevision, actor, label: "split", ops: [op] });
    }
    if (command === "merge") {
      const left = sub;
      const right = rest[0];
      if (!left || !right) throw new CliExit(1, { error: "validation", message: "merge <id> <id>" }, pretty);
      const baseRevision = await revisionOf(base, actor, slug);
      return finish(`${project}/ops`, "POST", {
        baseRevision,
        actor,
        label: "merge",
        ops: [{ op: "merge", clipIds: [left, right] }],
      });
    }
    if (command === "trim") {
      const id = sub;
      if (!id) throw new CliExit(1, { error: "validation", message: "trim <id> --start --end" }, pretty);
      const baseRevision = await revisionOf(base, actor, slug);
      const op: Record<string, unknown> = { op: "trim", clipId: id };
      if (flag(flags, "start")) op.start = Number(flag(flags, "start"));
      if (flag(flags, "end")) op.end = Number(flag(flags, "end"));
      if (flags.map.has("sample-accurate")) op.sampleAccurate = true;
      return finish(`${project}/ops`, "POST", { baseRevision, actor, label: "trim", ops: [op] });
    }
    if (command === "order") return finish(project).then((state) => ({ order: (state as { order: string[] }).order, revision: (state as { revision: number }).revision }));
    if (command === "undo") return finish(`${project}/undo`, "POST", {});
    if (command === "redo") return finish(`${project}/redo`, "POST", {});
    if (command === "history") return finish(`${project}/history`);
    if (command === "lint") return finish(`${project}/lint`);
    if (command === "render") {
      const quality = flags.map.has("preview") ? "preview" : "final";
      return finish(`${project}/render`, "POST", { quality });
    }
    if (command === "reanalyze") {
      const ids = [sub, ...rest].filter((item) => item && !item.startsWith("--"));
      const baseRevision = await revisionOf(base, actor, slug);
      return finish(`${project}/reanalyze`, "POST", {
        baseRevision,
        actor,
        mode: flag(flags, "mode") ?? "resegment",
        clipIds: ids,
        rangeStart: flag(flags, "start") ? Number(flag(flags, "start")) : undefined,
        rangeEnd: flag(flags, "end") ? Number(flag(flags, "end")) : undefined,
        silenceThreshold: flag(flags, "silence") ? Number(flag(flags, "silence")) : undefined,
        pad: flag(flags, "pad") ? Number(flag(flags, "pad")) : undefined,
        similarityThreshold: flag(flags, "similarity") ? Number(flag(flags, "similarity")) : undefined,
      });
    }
    throw new CliExit(1, {
      error: "validation",
      message: "Unknown command",
      allowed: ["projects", "import", "status", "clips", "clip", "play-info", "op", "reanalyze", "select", "reject", "split", "merge", "trim", "order", "undo", "redo", "history", "lint", "render", "schema"],
    }, pretty);
  } catch (error) {
    if (error instanceof CliExit) {
      error.pretty = pretty;
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw new CliExit(1, { error: "validation", message: "Invalid JSON", errors: [] }, pretty);
    }
    throw new CliExit(1, { error: "internal", message: error instanceof Error ? error.message : "CLI failed" }, pretty);
  }
}

function print(payload: unknown, pretty: boolean): void {
  const text = pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
  process.stdout.write(`${text}\n`);
}

const invoked = process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js");
if (invoked) {
  const stdin = process.stdin.isTTY ? "" : await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
  try {
    const result = await runCli(process.argv.slice(2), process.env, stdin);
    const pretty = process.argv.includes("--pretty");
    print(result, pretty);
  } catch (error) {
    if (error instanceof CliExit) {
      const text = error.pretty ? JSON.stringify(error.payload, null, 2) : JSON.stringify(error.payload);
      process.stderr.write(`${text}\n`);
      process.exit(error.code);
    }
    process.stderr.write(`${JSON.stringify({ error: "internal", message: error instanceof Error ? error.message : "CLI failed" })}\n`);
    process.exit(1);
  }
}
