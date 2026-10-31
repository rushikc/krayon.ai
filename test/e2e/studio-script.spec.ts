import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, removeProjectFolder, studioApi } from "../helpers/studio-api";

test("new-project form counts script lines and rebuild offers a script choice", async ({ page }) => {
  await page.goto("/studio");
  await expect(page.getByTestId("script-optional")).toBeVisible();
  await page.getByTestId("script-optional").click();
  await page.getByTestId("script-textarea").fill("hello world\n\nsecond line");
  await expect(page.getByTestId("script-line-count")).toHaveText("2 lines");

  const slug = (await studioApi.createProject(`e2e-script-${Date.now()}`)).slug;
  await fetch(`${process.env.E2E_API ?? "http://127.0.0.1:8789/api/studio"}/projects/${slug}/script`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision: 0, script: "hello world\nsecond line" }),
  });
  const analysis = path.join(REPO_ROOT, "studio", slug, "analysis");
  fs.mkdirSync(analysis, { recursive: true });
  fs.writeFileSync(
    path.join(analysis, "words.json"),
    JSON.stringify({ words: [{ text: "hello", start: 0.1, end: 0.4 }] }),
  );
  try {
    await page.goto(`/studio/${slug}`);
    await expect(page.getByRole("button", { name: "Rebuild" })).toBeEnabled();
    await page.getByRole("button", { name: "Rebuild" }).click();
    await expect(page.getByTestId("rebuild-with-script")).toBeVisible();
    await expect(page.getByTestId("rebuild-without-script")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  } finally {
    removeProjectFolder(slug);
  }
});
