import { expect, test } from "@playwright/test";
import { createFixtureProject, deleteProject } from "../helpers/fixture-project";
import { studioApi } from "../helpers/studio-api";
import { openStudio } from "../helpers/studio-page";

test.describe.configure({ timeout: 180_000 });

let slug: string | null = null;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  slug = (await createFixtureProject({ withScript: true, analyze: true })).slug;
});

test.afterAll(() => {
  if (slug) deleteProject(slug);
});

test.beforeEach(() => {
  test.skip(!slug, "No analyzed Studio project. Start pnpm dev.");
});

test("cancel leaves the pipeline and clip ids alone", async ({ page }) => {
  const before = await studioApi.project(slug!);
  await openStudio(page, slug!);
  await page.getByRole("button", { name: "Rebuild" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Rebuild from saved transcript?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  const after = await studioApi.project(slug!);
  expect(after.revision).toBe(before.revision);
  expect(after.clips.map((clip) => clip.id)).toEqual(before.clips.map((clip) => clip.id));
});

test("rebuild with script keeps ids and rebuild without script mints new ones", async ({ page }) => {
  const before = await studioApi.project(slug!);
  await openStudio(page, slug!);
  await expect(page.getByTestId("pipeline-badge")).toContainText("Scripted");
  await page.getByRole("button", { name: "Rebuild" }).click();
  await page.getByTestId("rebuild-with-script").click();
  await expect.poll(async () => (await studioApi.project(slug!)).revision).toBeGreaterThan(before.revision);
  const scripted = await studioApi.project(slug!);
  expect(scripted.clips.some((clip) => before.clips.some((old) => old.id === clip.id))).toBe(true);
  await page.getByRole("button", { name: "Rebuild" }).click();
  await page.getByTestId("rebuild-without-script").click();
  await expect.poll(async () => (await studioApi.project(slug!)).revision).toBeGreaterThan(scripted.revision);
  const transcript = await studioApi.project(slug!);
  expect(transcript.clips.every((clip) => !before.clips.some((old) => old.id === clip.id))).toBe(true);
  await expect(page.getByTestId("pipeline-badge")).toContainText("Transcript");
});
