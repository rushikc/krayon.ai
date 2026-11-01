import { expect, test } from "@playwright/test";

test("home tiles, logo, and back controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Krayon" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: /audio analysis/i })).toHaveAttribute("href", "/audio");
  await expect(page.getByRole("link", { name: /reel animations/i })).toHaveAttribute("href", "/reel-animations");
  await expect(page.getByRole("link", { name: /studio/i })).toHaveAttribute("href", "/studio");
  await expect(page.getByRole("button", { name: "Home" })).toHaveCount(0);

  await page.getByRole("link", { name: /studio/i }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.getByRole("button", { name: "Home" })).toBeVisible();
  await page.getByRole("button", { name: "Home" }).click();
  await expect(page).toHaveURL("/");

  await page.getByRole("link", { name: /audio analysis/i }).click();
  await expect(page).toHaveURL(/\/audio/);
  await page.getByRole("link", { name: "Krayon" }).click();
  await expect(page).toHaveURL("/");

  await page.getByRole("link", { name: /reel animations/i }).click();
  await expect(page).toHaveURL(/\/reel-animations/);
});
