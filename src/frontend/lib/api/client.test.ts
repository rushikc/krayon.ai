import { afterEach, describe, expect, it, vi } from "vitest";
import { clipAudioUrl, getEditorState, mediaStreamUrl, scanFolder } from "@/lib/api/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("legacy api client", () => {
  it("builds media urls and returns null for a missing editor", async () => {
    expect(mediaStreamUrl("abc")).toBe("/api/media/stream/abc");
    expect(clipAudioUrl("abc", "c1")).toBe("/api/media/clip/abc/c1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404, statusText: "Not Found" })));
    await expect(getEditorState("missing")).resolves.toBeNull();
  });

  it("throws the response text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("folder missing", { status: 400, statusText: "Bad Request" })),
    );
    await expect(scanFolder("/nope")).rejects.toThrow("folder missing");
  });

  it("falls back to the status text when the body is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500, statusText: "Server Error" })));
    await expect(scanFolder("/nope")).rejects.toThrow("Server Error");
  });
});
