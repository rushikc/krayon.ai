import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedLegacyEditor } from "../helpers/legacy-fixture";

test.describe.configure({ timeout: 120_000 });

test("seeded transcript lets Rebuild and clip preview run without Whisper", async ({ page }) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-legacy-"));
  const seeded = seedLegacyEditor(folder);
  await page.addInitScript((value) => localStorage.setItem("krayon:lastFolder", value), folder);
  await page.goto("/audio");
  const fileButton = page.getByRole("button", { name: new RegExp(path.basename(seeded.videoPath)) });
  await expect(fileButton).toBeVisible({ timeout: 20_000 });
  await fileButton.click();
  await page.getByRole("button", { name: "Open in editor" }).click();
  await expect(page.getByRole("button", { name: "Rebuild audio" })).toBeEnabled();
  await page.getByRole("button", { name: "Rebuild audio" }).click();
  await expect(page.getByRole("heading", { name: "Analyzing silence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rebuild audio" })).toBeEnabled({ timeout: 90_000 });
  await page.getByRole("button", { name: /Take / }).first().click();
  await expect(page.locator("audio")).toHaveCount(1);
  fs.rmSync(folder, { recursive: true, force: true });
});

test("Analyze silence with real Whisper @slow", async ({ page }) => {
  test.skip(process.env.E2E_WHISPER !== "1", "Real Whisper. Run with E2E_WHISPER=1.");
  test.setTimeout(240_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-whisper-"));
  const seeded = seedLegacyEditor(folder);
  fs.rmSync(path.join(folder, ".krayon"), { recursive: true, force: true });
  await page.addInitScript((value) => localStorage.setItem("krayon:lastFolder", value), folder);
  await page.goto("/audio");
  await page.getByRole("button", { name: new RegExp(path.basename(seeded.videoPath)) }).click();
  await page.getByRole("button", { name: "Open in editor" }).click();
  await page.getByRole("button", { name: "Analyze silence" }).click();
  await expect(page.getByRole("heading", { name: "Analyzing silence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Analyze silence" })).toBeEnabled({ timeout: 180_000 });
  fs.rmSync(folder, { recursive: true, force: true });
});
