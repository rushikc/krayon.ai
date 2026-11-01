import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "@/lib/api/studio-client";

const ok = {
  revision: 2,
  settings: { silenceThreshold: 0.4 },
  projects: [],
  current: null,
  items: [],
  warnings: [],
  words: [],
  files: [],
  manifests: [],
  segments: [],
  sourceDuration: 1,
  duration: 1,
  peaks: [],
  path: "/tmp/a.mp4",
  cancelled: false,
  sourcePath: "/tmp/a.mp4",
  clipCount: 1,
  summary: "ok",
  order: [],
  id: "q-0001",
  status: "ok",
  renderId: "preview-1",
  outputName: "preview-1.mp4",
  ratio: 0,
  message: "saved",
  script: "",
  scriptLineCount: 0,
  needsRebuild: false,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("studio client", () => {
  it("calls every exported request and builds media urls", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        return jsonResponse(ok);
      }),
    );
    await client.listProjects();
    await client.createProject("Demo", "line");
    await client.updateScript("demo", 1, "line");
    await client.getProject("demo");
    await client.importPath("demo", "/tmp/a.mp4");
    await client.pickFile();
    await client.analyze("demo", 1);
    await client.applyOps("demo", 1, [{ op: "select", clipId: "c-0001" }], "select");
    await client.reanalyze("demo", 1, { mode: "regroup" });
    await client.undo("demo");
    await client.redo("demo");
    await client.restore("demo", 1);
    await client.lintProject("demo");
    await client.getSettings("demo");
    await client.updateSettings("demo", { pad: 0.08 });
    await client.listSegments("demo");
    await client.getTranscript("demo");
    await client.listOutputs("demo");
    await client.cancelRender("demo", "preview-1");
    await client.startRender("demo", "preview");
    await client.renderStatus("demo", "preview-1");
    await client.getClipPeaks("demo", "c-0001", 40, 0.2);
    await client.listConfirmations("demo", "pending");
    await client.answerConfirmation("demo", "q-0001", "accept", "ok");
    const file = new File(["x"], "talk.mp4", { type: "video/mp4" });
    await client.importFile("demo", file);
    expect(urls.some((url) => url.endsWith("/projects"))).toBe(true);
    expect(urls.some((url) => url.includes("/projects/demo/import"))).toBe(true);
    expect(urls.some((url) => url.includes("/events"))).toBe(false);
    expect(client.sourceUrl("demo")).toBe("/api/studio/projects/demo/media/source");
    expect(client.outputUrl("demo", "final 1.mp4")).toContain("final%201.mp4");
    expect(client.eventsUrl("demo")).toBe("/api/studio/projects/demo/events");
    expect(client.audioUrl("demo", "c-0001", 0.25)).toContain("pad=0.25");
    expect(client.peaksUrl("demo", "c-0001", 40, 0.2)).toContain("buckets=40");
  });

  it("throws StudioConflictError with the current revision on 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "stale", currentRevision: 7 }, 409)),
    );
    await expect(client.applyOps("demo", 1, [{ op: "note", clipId: "c-0001", note: "x" }])).rejects.toBeInstanceOf(
      client.StudioConflictError,
    );
    try {
      await client.getProject("demo");
    } catch (error) {
      expect(error).toBeInstanceOf(client.StudioConflictError);
      expect((error as client.StudioConflictError).currentRevision).toBe(7);
      expect((error as Error).message).toBe("stale");
    }
  });

  it("lets a network rejection propagate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await expect(client.listProjects()).rejects.toThrow("offline");
  });

  it("maps a 422 body to Error(message)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "Invalid request" }, 422)),
    );
    await expect(client.updateSettings("demo", { pad: 1 })).rejects.toThrow("Invalid request");
  });

  it.fails("BUG: 422 validation errors are not preserved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { message: "Invalid request", errors: [{ field: "pad", message: "too wide" }] },
          422,
        ),
      ),
    );
    try {
      await client.updateSettings("demo", { pad: 1 });
      throw new Error("expected a throw");
    } catch (error) {
      expect(JSON.stringify(error)).toContain("pad");
    }
  });
});
