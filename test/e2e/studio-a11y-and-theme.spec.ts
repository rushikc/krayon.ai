import { expect, test } from "@playwright/test";
import { createFixtureProject, deleteProject } from "../helpers/fixture-project";
import { collectPageErrors, openStudio, selectClip } from "../helpers/studio-page";

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

test("keyboard-only clip list and no console errors", async ({ page }) => {
  const errors = collectPageErrors(page);
  await openStudio(page, slug!);
  await page.keyboard.press("j");
  await expect(page.getByTestId("clip-data")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("clip-data")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("landing, clip list, waveform, and transcript match screenshots in both themes", async ({ page }) => {
  await page.goto("/studio");
  await expect(page.getByRole("button", { name: "Create" })).toBeVisible();
  const form = page.locator("form");
  await expect(form).toHaveScreenshot("landing-form-dark.png", { maxDiffPixelRatio: 0.02 });
  await page.getByRole("button", { name: /Switch to light mode/ }).click();
  await expect(form).toHaveScreenshot("landing-form-light.png", { maxDiffPixelRatio: 0.02 });
  await page.getByRole("button", { name: /Switch to dark mode/ }).click();

  await openStudio(page, slug!);
  const clipId = await page.getByTestId("studio-clips").locator('[title="Copy clip id"]').first().innerText();
  await selectClip(page, clipId);
  await expect(page.getByTestId("studio-waveform")).toBeVisible();
  await expect(page.getByTestId("studio-clips")).toHaveScreenshot("clips-dark.png", { maxDiffPixelRatio: 0.02 });
  await expect(page.getByTestId("studio-waveform")).toHaveScreenshot("waveform-dark.png", { maxDiffPixelRatio: 0.02 });
  await page.getByRole("button", { name: "View transcript" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveScreenshot("transcript-dark.png", { maxDiffPixelRatio: 0.02 });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Switch to light mode/ }).click();
  await expect(page.getByTestId("studio-clips")).toHaveScreenshot("clips-light.png", { maxDiffPixelRatio: 0.02 });
  await expect(page.getByTestId("studio-waveform")).toHaveScreenshot("waveform-light.png", { maxDiffPixelRatio: 0.02 });
  await page.getByRole("button", { name: "View transcript" }).click();
  await expect(page.getByRole("dialog")).toHaveScreenshot("transcript-light.png", { maxDiffPixelRatio: 0.02 });
});

test("narrow viewports do not overflow horizontally", async ({ page }) => {
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1024, height: 700 },
  ] as const) {
    await page.setViewportSize(size);
    await openStudio(page, slug!);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
