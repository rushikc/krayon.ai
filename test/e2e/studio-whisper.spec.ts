import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createFixtureProject, deleteProject } from "../helpers/fixture-project";
import { REPO_ROOT, studioApi } from "../helpers/studio-api";
import { openStudio } from "../helpers/studio-page";

test("analyze after deleting words.json runs Whisper @slow", async ({ page }) => {
  test.skip(process.env.E2E_WHISPER !== "1", "Real Whisper. Run with E2E_WHISPER=1.");
  test.setTimeout(240_000);
  const fixture = await createFixtureProject({ analyze: true });
  try {
    fs.unlinkSync(path.join(REPO_ROOT, "studio", fixture.slug, "analysis", "words.json"));
    const revision = await studioApi.currentRevision(fixture.slug);
    await openStudio(page, fixture.slug);
    await page.getByRole("button", { name: "Analyze audio" }).click();
    await expect.poll(async () => (await studioApi.currentRevision(fixture.slug)), { timeout: 180_000 }).toBeGreaterThan(revision);
    const project = await studioApi.project(fixture.slug);
    expect(project.clips.length).toBeGreaterThan(0);
  } finally {
    deleteProject(fixture.slug);
  }
});
