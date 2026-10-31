import { expect, test } from "@playwright/test";
import { removeProjectFolder, studioApi } from "../helpers/studio-api";

let slug = "";

test.beforeAll(async () => {
  slug = (await studioApi.createProject(`e2e-empty-${Date.now()}`)).slug;
});

test.afterAll(() => {
  if (slug) removeProjectFolder(slug);
});

test("project with no clips shows only Analyze and Rebuild, no render or segment buttons", async ({ page }) => {
  await page.goto(`/studio/${slug}`);
  await expect(page.getByRole("button", { name: "Analyze audio" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rebuild" })).toBeVisible();
  for (const name of ["Show all segments", "View transcript", "Render preview", "Render final video"]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  }
  await expect(page.getByText("Recent renders")).toHaveCount(0);
});

test("Analyze audio is disabled when the project has no source video", async ({ page }) => {
  await page.goto(`/studio/${slug}`);
  await expect(page.getByRole("button", { name: "Analyze audio" })).toBeDisabled();
});
