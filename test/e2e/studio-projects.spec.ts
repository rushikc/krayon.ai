import path from "node:path";
import { expect, test } from "@playwright/test";
import { createFixtureProject, deleteProject } from "../helpers/fixture-project";
import { REPO_ROOT, studioApi } from "../helpers/studio-api";

const created: string[] = [];

async function cleanup() {
  for (const slug of created.splice(0)) {
    try {
      await studioApi.deleteProject(slug);
    } catch {
      deleteProject(slug);
    }
  }
}

test.afterAll(async () => {
  await cleanup();
});

test("landing create shows analysis stages then loads clips", async ({ page }) => {
  const fixture = await createFixtureProject({ analyze: false });
  created.push(fixture.slug);
  await page.goto(`/studio/${fixture.slug}`);
  const stepper = page.getByTestId("studio-analysis-stepper");
  await expect(stepper.or(page.getByTestId("studio-clips"))).toBeVisible({ timeout: 30_000 });
  if (await stepper.isVisible().catch(() => false)) {
    await expect(stepper.getByText(/Extract audio|Transcribe|Cut by silence|Group retakes|Save clips/)).toBeVisible();
  }
  await expect(page.getByTestId("studio-clips")).toBeVisible({ timeout: 60_000 });
});

test("duplicate name shows an error and does not add a project", async ({ page }) => {
  const name = `e2e-dup-${Date.now()}`;
  const createdOnce = await studioApi.createProject(name);
  created.push(createdOnce.slug);
  const before = await studioApi.projects();
  const count = before.projects.filter((item) => item.slug.startsWith("e2e-dup-")).length;
  await page.goto("/studio");
  await page.getByPlaceholder("Lecture 12").fill(name);
  await expect(page.getByText("A project with this name already exists")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create" })).toBeDisabled();
  const after = await studioApi.projects();
  expect(after.projects.filter((item) => item.slug.startsWith("e2e-dup-")).length).toBe(count);
});

test("delete from the list removes the project", async ({ page }) => {
  const title = `e2e-list-${Date.now()}`;
  const { slug } = await studioApi.createProject(title);
  created.push(slug);
  await page.goto("/studio");
  await page.getByRole("button", { name: `Delete project ${title}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("studio-project-list").getByText(title)).toHaveCount(0);
  created.splice(created.indexOf(slug), 1);
});

test("delete from inside the project returns to /studio", async ({ page }) => {
  const title = `e2e-inside-${Date.now()}`;
  const { slug } = await studioApi.createProject(title);
  created.push(slug);
  await page.goto(`/studio/${slug}`);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.getByTestId("studio-project-list").getByText(title)).toHaveCount(0);
  created.splice(created.indexOf(slug), 1);
});

test("landing scroller is thin and the document does not double-scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/studio");
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const scroller = document.querySelector("[data-testid=studio-landing-scroll]");
    const style = scroller ? getComputedStyle(scroller) : null;
    return {
      docOverflow: doc.scrollWidth <= doc.clientWidth,
      scrollbarWidth: style?.scrollbarWidth ?? "",
    };
  });
  expect(metrics.docOverflow).toBe(true);
  expect(metrics.scrollbarWidth).toBe("thin");
});

test("delete-all UI refuses unless the studio root is a temp directory", async ({ page }) => {
  const health = await studioApi.health();
  const root = health.projectsDir ?? "";
  const tmpRoot = path.resolve(REPO_ROOT, "tmp");
  const envRoot = process.env.KRAYON_STUDIO_ROOT;
  const allowed =
    Boolean(envRoot && path.resolve(envRoot) === path.resolve(root)) &&
    (root.includes(`${path.sep}tmp${path.sep}`) || root.startsWith(tmpRoot) || root.includes("/tmp/") || root.includes("/var/folders/"));
  test.skip(!allowed, `delete-all e2e skipped; studio root is ${root || "unknown"}`);
  await page.goto("/studio");
  await page.getByRole("button", { name: "Delete all" }).click();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("dialog").getByRole("button", { name: "Delete all" }).click();
});
