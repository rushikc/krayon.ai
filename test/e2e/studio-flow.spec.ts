import { expect, test } from "@playwright/test";
import { createFixtureProject, deleteProject, FIXTURE_SCRIPT, FIXTURE_TRUTH } from "../helpers/fixture-project";
import { studioApi } from "../helpers/studio-api";
import { openStudio } from "../helpers/studio-page";

test.describe.configure({ timeout: 120_000 });

let slug: string | null = null;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const fixture = await createFixtureProject({ analyze: true });
  slug = fixture.slug;
});

test.afterAll(() => {
  if (slug) deleteProject(slug);
});

test("landing page counts script lines before create", async ({ page }) => {
  await page.goto("/studio");
  await expect(page.getByTestId("script-optional")).toBeVisible();
  await page.getByTestId("script-optional").click();
  await page.getByTestId("script-textarea").fill(FIXTURE_SCRIPT);
  await expect(page.getByTestId("script-line-count")).toHaveText("3 lines");
  await expect(page.getByPlaceholder("/path/to/recording.mp4")).toBeVisible();
});

test("analyzed fixture has the designed clip count", async ({ page }) => {
  test.skip(!slug, "No analyzed Studio project. Start pnpm dev.");
  const project = await studioApi.project(slug!);
  expect(project.clips).toHaveLength(FIXTURE_TRUTH.clipCount);
  await openStudio(page, slug!);
  const toggle = page.getByTestId("toggle-all-groups");
  if ((await toggle.getAttribute("aria-label")) === "Expand all") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-label", "Collapse all");
  const ids = await page.getByTestId("studio-clips").locator('[title="Copy clip id"]').allTextContents();
  expect(ids).toHaveLength(FIXTURE_TRUTH.clipCount);
});
