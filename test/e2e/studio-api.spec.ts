import { expect, test } from "@playwright/test";
import { createFixtureProject, deleteProject } from "../helpers/fixture-project";
import { API, pickProject, studioApi } from "../helpers/studio-api";

let slug: string | null = null;
let clipId = "";
let owned = false;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  if (process.env.E2E_REAL === "1") {
    slug = await pickProject();
  } else {
    const fixture = await createFixtureProject({ analyze: true });
    slug = fixture.slug;
    owned = true;
  }
  if (slug) clipId = (await studioApi.project(slug)).clips[0]?.id ?? "";
});

test.afterAll(() => {
  if (owned && slug) deleteProject(slug);
});

test.beforeEach(() => {
  test.skip(!slug || !clipId, "No analyzed Studio project. Start pnpm dev, or set E2E_REAL=1.");
});

test("health and project listing respond", async () => {
  const health = await fetch(`${API}/health`);
  expect(health.ok).toBe(true);
  const { projects } = await studioApi.projects();
  expect(projects.length).toBeGreaterThan(0);
});

test("clips carry llm and statusReason fields", async () => {
  const { clips } = await studioApi.project(slug!);
  expect(clips.length).toBeGreaterThan(0);
  for (const clip of clips.slice(0, 5)) {
    expect(["selected", "rejected", "undecided"]).toContain(clip.status);
    expect(clip.llm === undefined || typeof clip.llm === "object").toBe(true);
  }
});

test("peaks endpoint returns the requested number of buckets", async ({ request }) => {
  const res = await request.get(`${API}/projects/${slug}/clips/${clipId}/peaks?buckets=200`);
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.duration).toBeGreaterThan(0);
  expect(body.peaks.length).toBeGreaterThanOrEqual(200);
});

test("clip audio supports HTTP Range so the browser can seek", async ({ request }) => {
  const url = `${API}/projects/${slug}/clips/${clipId}/audio.wav?pad=0.05`;
  const res = await request.get(url, { headers: { Range: "bytes=1000-1999" } });
  expect(res.status(), "Range request should answer 206 Partial Content").toBe(206);
  expect(res.headers()["accept-ranges"]).toBe("bytes");
  expect(res.headers()["content-range"]).toMatch(/^bytes 1000-1999\/\d+$/);
  expect((await res.body()).length).toBe(1000);
});

test("clip audio without a Range header still returns the full wav", async ({ request }) => {
  const res = await request.get(`${API}/projects/${slug}/clips/${clipId}/audio.wav?pad=0.05`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("audio/wav");
});

test("an op with a stale baseRevision is rejected with 409", async ({ request }) => {
  const project = await studioApi.project(slug!);
  const res = await request.post(`${API}/projects/${slug}/ops`, {
    data: { baseRevision: project.revision + 999, ops: [{ op: "select", clipId }] },
  });
  expect(res.status()).toBe(409);
});
