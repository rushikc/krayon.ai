import { expect, type Page } from "@playwright/test";

export async function openStudio(page: Page, slug: string) {
  await page.goto(`/studio/${slug}`);
  await expect(page.getByTestId("studio-clips")).toBeVisible();
  // Rows render after the project loads; wait for the first one.
  await expect(page.getByTestId("studio-clips").locator('[title="Copy clip id"]').first()).toBeVisible();
}

export function clipRow(page: Page, id: string) {
  return page.getByTestId("studio-clips").getByRole("button").filter({ hasText: id }).first();
}

export async function selectClip(page: Page, id: string) {
  // Click the left edge of the row: the id label and the Play button have their own click handlers.
  await clipRow(page, id).click({ position: { x: 24, y: 10 } });
  await expect(page.getByTestId("clip-data")).toBeVisible();
}

export async function waveformBox(page: Page) {
  const canvas = page.getByTestId("studio-waveform");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("waveform has no bounding box");
  return box;
}

/** Click the waveform at a fraction (0..1) of its width. */
export async function clickWaveform(page: Page, fraction: number) {
  const box = await waveformBox(page);
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}
