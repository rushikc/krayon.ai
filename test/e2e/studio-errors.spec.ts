import { expect, test } from "@playwright/test";
import { createFixtureProject, deleteProject } from "../helpers/fixture-project";
import { studioApi } from "../helpers/studio-api";
import { openStudio, selectClip } from "../helpers/studio-page";

test.describe.configure({ timeout: 120_000 });

test("a bad video path returns a readable message", async ({ page }) => {
  await page.goto("/studio");
  await page.getByPlaceholder("Lecture 12").fill(`e2e-missing-${Date.now()}`);
  await page.getByPlaceholder("/path/to/recording.mp4").fill("/tmp/krayon-missing-video.mp4");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("p.text-destructive")).toBeVisible();
  await expect(page.locator("p.text-destructive")).toContainText(/ENOENT|no such file|not a file|failed/i);
});

test("aborting the Studio API shows an error and recovers after the route is restored", async ({ page }) => {
  const fixture = await createFixtureProject({ analyze: true });
  try {
    await page.route("**/api/studio/projects/**", (route) => {
      if (route.request().method() === "GET" && route.request().url().includes(`/projects/${fixture.slug}`)) {
        return route.abort("failed");
      }
      return route.continue();
    });
    await page.goto(`/studio/${fixture.slug}`);
    await expect(page.locator("p.text-destructive")).toBeVisible();
    await page.unroute("**/api/studio/projects/**");
    await page.reload();
    await expect(page.getByTestId("studio-clips")).toBeVisible();
  } finally {
    deleteProject(fixture.slug);
  }
});

test("analysis failure surfaces Retry; reset-status recovers a stuck analyzing project", async ({ page }) => {
  const fixture = await createFixtureProject({ analyze: true });
  try {
    await page.route("**/api/studio/projects/*/analyze", (route) => route.abort("failed"));
    await openStudio(page, fixture.slug);
    await page.getByRole("button", { name: "Analyze audio" }).click();
    await expect(page.locator("p.text-destructive")).toBeVisible();
    await page.unroute("**/api/studio/projects/*/analyze");
    const reset = await studioApi.resetStatus(fixture.slug);
    expect(["ready", "error", "empty"]).toContain(reset.status);
    await page.reload();
    await expect(page.getByRole("button", { name: "Analyze audio" })).toBeEnabled();
  } finally {
    deleteProject(fixture.slug);
  }
});

test("two browsers editing the same project show the conflict message", async ({ browser }) => {
  const fixture = await createFixtureProject({ analyze: true });
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const page1 = await first.newPage();
    const page2 = await second.newPage();
    const clip = (await studioApi.project(fixture.slug)).clips[0];
    await page2.route("**/api/studio/projects/**/events", (route) => route.abort());
    await openStudio(page1, fixture.slug);
    await openStudio(page2, fixture.slug);
    await selectClip(page1, clip.id);
    await selectClip(page2, clip.id);
    await page1.getByRole("button", { name: "Accept", exact: true }).click();
    await expect.poll(async () => (await studioApi.clip(fixture.slug, clip.id)).clip.status).toBe("selected");
    await page2.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(page2.getByText("This cut changed. Reloaded the clip.")).toBeVisible();
  } finally {
    await first.close();
    await second.close();
    deleteProject(fixture.slug);
  }
});
