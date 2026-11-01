import { expect, test } from "@playwright/test";

const validScene = [
  {
    id: "box-a",
    type: "box",
    matrix: [4, 8, 13, 12],
    label: "Fixture Box",
    colorTheme: "sky",
    time: { start: 0, end: 8, track: 1 },
  },
];

const doneJob = {
  id: "job-valid",
  status: "done",
  script: "fixture",
  maxRounds: 1,
  passScore: 7,
  models: { generate: "g", review: "r", fix: "f" },
  progress: { phase: "done", message: "Done", round: 1, ratio: 1 },
  rounds: [{ n: 1, scene: validScene, scores: { overall: 8, clarity: 8, readability: 8, accuracy: 8 }, pass: true, issues: [], keyframes: [] }],
  result: { round: 1, scene: validScene, scores: { overall: 8, clarity: 8, readability: 8, accuracy: 8 } },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const invalidJob = {
  ...doneJob,
  id: "job-invalid",
  result: { round: 1, scene: [{ id: "bad", type: "not-a-shape" }], scores: null },
  rounds: [{ n: 1, scene: [{ id: "bad", type: "not-a-shape" }], scores: null, pass: false, issues: [], keyframes: [] }],
};

test("reel page loads, chat asks for a key, timeline edit opens, and fulfilled jobs apply or error", async ({ page }) => {
  await page.route("**/api/reel/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/health")) {
      await route.fulfill({ json: { ok: true, service: "reel-backend" } });
      return;
    }
    if (url.endsWith("/jobs") && route.request().method() === "GET") {
      await route.fulfill({ json: { jobs: [] } });
      return;
    }
    if (url.includes("/jobs/job-valid")) {
      await route.fulfill({ json: doneJob });
      return;
    }
    if (url.includes("/jobs/job-invalid")) {
      await route.fulfill({ json: invalidJob });
      return;
    }
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto("/reel-animations");
  await expect(page.getByRole("tab", { name: "Chat" })).toBeVisible();
  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(page.getByRole("heading", { name: "Reel assistant" })).toBeVisible();
  await page.getByLabel("Chat message").fill("explain a box");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("dialog", { name: "Gemini API key" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Timeline" }).click();
  const block = page.locator('[data-segment-type="box"]').filter({ hasText: "Client" }).locator('[tabindex="0"]');
  await block.click();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.evaluate(() => localStorage.setItem("krayon-reel-thread-ids", JSON.stringify(["job-valid"])));
  await page.reload();
  await page.getByRole("tab", { name: "Chat" }).click();
  await page.getByRole("button", { name: "Apply to timeline" }).click();
  await expect(page.getByText(/Applied round 1/)).toBeVisible();
  await expect(page.getByText("Fixture Box").first()).toBeVisible();

  await page.evaluate(() => localStorage.setItem("krayon-reel-thread-ids", JSON.stringify(["job-invalid"])));
  await page.reload();
  await page.getByRole("tab", { name: "Chat" }).click();
  await page.getByRole("button", { name: "Apply to timeline" }).click();
  await expect(page.getByText(/unknown type/i)).toBeVisible();
});
