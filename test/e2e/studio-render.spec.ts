import { expect, test } from "@playwright/test";
import { createFixtureProject, deleteProject } from "../helpers/fixture-project";
import { API } from "../helpers/studio-api";
import { openStudio } from "../helpers/studio-page";

test.describe.configure({ timeout: 240_000 });

let slug: string | null = null;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  test.skip(process.env.E2E_RENDER !== "1", "Slow: renders a preview. Run with E2E_RENDER=1.");
  slug = (await createFixtureProject({ analyze: true })).slug;
});

test.afterAll(() => {
  if (slug) deleteProject(slug);
});

test("preview render can be cancelled, then a full preview plays @slow", async ({ page }) => {
  test.skip(!slug, "No analyzed Studio project. Start pnpm dev.");
  test.setTimeout(240_000);
  await openStudio(page, slug!);
  await page.getByRole("button", { name: "Render preview" }).click();
  await expect(page.getByTestId("render-progress")).toBeVisible();
  await page.getByRole("button", { name: "Cancel render" }).click();
  await expect(page.getByRole("button", { name: "Cancel render" })).toBeHidden({ timeout: 30_000 });

  await page.getByRole("button", { name: "Render preview" }).click();
  await expect(page.getByTestId("render-progress")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel render" })).toBeHidden({ timeout: 200_000 });
  await page.getByRole("button", { name: "Rendered video" }).click();
  const video = page.getByTestId("rendered-video").locator("video");
  await expect(video).toBeVisible();
  const duration = await video.evaluate((el: HTMLVideoElement) => el.duration);
  const listed = await fetch(`${API}/projects/${slug}/output`).then((r) => r.json()) as {
    manifests: Array<{ duration: number }>;
  };
  expect(listed.manifests.length).toBeGreaterThan(0);
  expect(Math.abs(duration - listed.manifests[0].duration)).toBeLessThan(0.2);
});
