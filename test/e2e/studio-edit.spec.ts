import { expect, test } from "@playwright/test";
import { createFixtureProject, deleteProject } from "../helpers/fixture-project";
import { studioApi } from "../helpers/studio-api";
import { clickWaveform, openStudio, selectClip } from "../helpers/studio-page";

test.describe.configure({ timeout: 120_000 });

let slug: string | null = null;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  slug = (await createFixtureProject({ analyze: true })).slug;
});

test.afterAll(() => {
  if (slug) deleteProject(slug);
});

test.beforeEach(() => {
  test.skip(!slug, "No analyzed Studio project. Start pnpm dev.");
});

test("accept and reject from the preview, then undo and redo with the buttons", async ({ page }) => {
  const start = await studioApi.currentRevision(slug!);
  const clip = (await studioApi.project(slug!)).clips.find((item) => item.status !== "selected") ?? (await studioApi.project(slug!)).clips[0];
  await openStudio(page, slug!);
  await selectClip(page, clip.id);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(async () => (await studioApi.clip(slug!, clip.id)).clip.status).toBe("selected");
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect.poll(async () => (await studioApi.clip(slug!, clip.id)).clip.status).toBe("rejected");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await studioApi.clip(slug!, clip.id)).clip.status).toBe("selected");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect.poll(async () => (await studioApi.clip(slug!, clip.id)).clip.status).toBe("rejected");
  await studioApi.rollbackTo(slug!, start);
});

test("split with S, merge and trim through the API, and keep the result after reload", async ({ page }) => {
  const start = await studioApi.currentRevision(slug!);
  const clip = (await studioApi.project(slug!)).clips.find((item) => item.duration >= 3) ?? (await studioApi.project(slug!)).clips[0];
  await openStudio(page, slug!);
  await selectClip(page, clip.id);
  await page.getByTestId("waveform-edit").click();
  await clickWaveform(page, 0.45);
  await page.keyboard.press("s");
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect.poll(async () => (await studioApi.project(slug!)).clips.filter((item) => item.parentIds?.includes(clip.id)).length).toBe(2);
  const kids = (await studioApi.project(slug!)).clips.filter((item) => item.parentIds?.includes(clip.id));
  const revision = await studioApi.currentRevision(slug!);
  const merged = await studioApi.applyOps(slug!, revision, [{ op: "merge", clipIds: [kids[0].id, kids[1].id] }], "merge");
  const mergedClip = (await studioApi.project(slug!)).clips.find((item) => item.parentIds?.includes(kids[0].id));
  expect(mergedClip).toBeTruthy();
  const mid = (mergedClip!.sourceStart + mergedClip!.sourceEnd) / 2;
  await studioApi.applyOps(slug!, merged.revision, [{ op: "trim", clipId: mergedClip!.id, end: mid, sampleAccurate: true }], "trim");
  await page.reload();
  await openStudio(page, slug!);
  const afterReload = await studioApi.project(slug!);
  expect(afterReload.clips.some((item) => item.id === mergedClip!.id)).toBe(true);
  expect(afterReload.clips.find((item) => item.id === mergedClip!.id)!.sourceEnd).toBeCloseTo(mid, 1);
  await selectClip(page, mergedClip!.id);
  await expect(page.getByTestId("clip-data")).toBeVisible();
  await studioApi.rollbackTo(slug!, start);
});

test("an op posted through the API shows up over SSE without a reload", async ({ page }) => {
  const start = await studioApi.currentRevision(slug!);
  const clip = (await studioApi.project(slug!)).clips.find((item) => item.status !== "rejected") ?? (await studioApi.project(slug!)).clips[0];
  await openStudio(page, slug!);
  await selectClip(page, clip.id);
  const revision = await studioApi.currentRevision(slug!);
  await studioApi.applyOps(slug!, revision, [{ op: "reject", clipId: clip.id }], "reject");
  await expect.poll(async () => page.getByTestId("status-badge").innerText()).toMatch(/reject/i);
  await studioApi.rollbackTo(slug!, start);
});
