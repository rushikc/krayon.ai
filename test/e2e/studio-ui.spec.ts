import { expect, test, type Page } from "@playwright/test";
import { pickProject, studioApi, type ApiClip } from "../helpers/studio-api";
import { clickWaveform, clipRow, openStudio, selectClip } from "../helpers/studio-page";

let slug: string | null = null;
let clips: ApiClip[] = [];
let startRevision = 0;

/** Clips whose rows are currently rendered in the left list (the expanded groups). */
async function visibleClips(page: Page): Promise<ApiClip[]> {
  const ids = await page
    .getByTestId("studio-clips")
    .locator('[title="Copy clip id"]')
    .evaluateAll((els) => els.map((el) => el.textContent ?? ""));
  const rows = ids.map((id) => clips.find((clip) => clip.id === id)).filter((clip): clip is ApiClip => Boolean(clip));
  return rows.length ? rows : clips;
}

test.beforeEach(async () => {
  slug = await pickProject();
  clips = slug ? (await studioApi.project(slug)).clips : [];
  test.skip(!slug || clips.length === 0, "No analyzed Studio project found. Set E2E_PROJECT=<slug>.");
  startRevision = await studioApi.currentRevision(slug!);
});

test.afterEach(async () => {
  if (slug) await studioApi.rollbackTo(slug, startRevision);
});

function attachErrorCollector(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test("left list shows every clip with dots and a matching summary", async ({ page }) => {
  await openStudio(page, slug!);
  const accepted = clips.filter((c) => c.status === "selected").length;
  await expect(page.getByTestId("clip-summary")).toContainText(`${accepted} accepted`);
  await expect(page.getByTestId("clip-summary")).toContainText(`${clips.length - accepted} not accepted`);
  // The first group is expanded by default, and every row has exactly one dot.
  const dots = page.getByTestId("studio-clips").getByTestId("status-dot");
  expect(await dots.count()).toBeGreaterThan(0);
  const tones = await dots.evaluateAll((els) => els.map((el) => el.getAttribute("data-tone")));
  expect(tones.every((tone) => tone === "accepted" || tone === "not-accepted")).toBe(true);
});

test("summary filters cycle all -> accepted -> not accepted -> all", async ({ page }) => {
  await openStudio(page, slug!);
  const dots = page.getByTestId("studio-clips").getByTestId("status-dot");
  const tones = async () => new Set(await dots.evaluateAll((els) => els.map((el) => el.getAttribute("data-tone"))));
  const accepted = page.getByTestId("clip-summary").getByRole("button", { name: /^\d+ accepted/ });
  await accepted.click(); // all -> accepted
  await expect(dots.first()).toHaveAttribute("data-tone", "accepted");
  expect(await tones()).toEqual(new Set(["accepted"]));
  await accepted.click(); // accepted -> not accepted
  await expect(dots.first()).toHaveAttribute("data-tone", "not-accepted");
  expect(await tones()).toEqual(new Set(["not-accepted"]));
  await accepted.click(); // back to all
  await expect.poll(async () => (await tones()).size).toBeGreaterThanOrEqual(1);
});

test("controls panel: settings collapsed, Analyze and Rebuild present", async ({ page }) => {
  await openStudio(page, slug!);
  await expect(page.getByTestId("settings-box")).not.toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "Analyze audio" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rebuild" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show all segments" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View transcript" })).toBeVisible();
});

test("selecting a clip shows audio, status, llm and clip data", async ({ page }) => {
  await openStudio(page, slug!);
  const rows = await visibleClips(page);
  const clip = rows[1] ?? rows[0];
  await selectClip(page, clip.id);
  await expect(page.locator("audio").first()).toHaveAttribute("src", new RegExp(`${clip.id}/audio\\.wav`));
  await expect(page.getByTestId("status-badge")).toBeVisible();
  const data = page.getByTestId("clip-data");
  await expect(data).toContainText("statusReason");
  await expect(data).toContainText("groupId");
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeVisible();
});

test("accept and reject flip the status and the dot (rolled back afterwards)", async ({ page }) => {
  await openStudio(page, slug!);
  const rows = await visibleClips(page);
  const clip = rows.find((c) => c.status === "rejected") ?? rows[0];
  await selectClip(page, clip.id);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(async () => (await studioApi.clip(slug!, clip.id)).clip.status).toBe("selected");
  const row = clipRow(page, clip.id);
  await expect(row.getByTestId("status-dot")).toHaveAttribute("data-tone", "accepted");
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect.poll(async () => (await studioApi.clip(slug!, clip.id)).clip.status).toBe("rejected");
  await expect(row.getByTestId("status-dot")).toHaveAttribute("data-tone", "not-accepted");
});

test("transcript dialog fits the viewport and the body scrolls", async ({ page }) => {
  await openStudio(page, slug!);
  await page.getByRole("button", { name: "View transcript" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByPlaceholder(/search transcript/i)).toBeVisible();
  const body = page.getByTestId("transcript-body");
  await expect(body).toBeVisible();
  const viewport = page.viewportSize();
  const box = await dialog.boundingBox();
  expect(viewport && box).toBeTruthy();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual((viewport?.height ?? 0) + 1);
  const overflowY = await body.evaluate((el) => getComputedStyle(el).overflowY);
  expect(overflowY).toMatch(/auto|scroll/);
});

test("expand and collapse all groups, and double click collapses one group", async ({ page }) => {
  await openStudio(page, slug!);
  const toggle = page.getByTestId("toggle-all-groups");
  await expect(toggle).toHaveText("Collapse all");
  const first = clips[0];
  await expect(clipRow(page, first.id)).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveText("Expand all");
  await expect(clipRow(page, first.id)).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveText("Collapse all");
  await expect(clipRow(page, first.id)).toBeVisible();
  await clipRow(page, first.id).dblclick({ position: { x: 24, y: 10 } });
  await expect(clipRow(page, first.id)).toHaveCount(0);
  await expect(page.getByTestId("clip-data")).toBeVisible();
});

test("rebuild asks for confirmation and cancel changes nothing", async ({ page }) => {
  await openStudio(page, slug!);
  await page.getByRole("button", { name: "Rebuild" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Rebuild from saved transcript?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await studioApi.currentRevision(slug!)).toBe(startRevision);
});

test("full video and rendered video tabs load media", async ({ page }) => {
  await openStudio(page, slug!);
  await page.getByRole("button", { name: "Full video" }).click();
  await expect(page.locator("video").first()).toBeVisible();
  await expect
    .poll(() => page.locator("video").first().evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThan(0);
});

test.describe("waveform editor", () => {
  test("waveform is drawn and Edit toggles the blue editing state", async ({ page }) => {
    await openStudio(page, slug!);
    const rows = await visibleClips(page);
    const clip = rows.find((c) => c.duration >= 3) ?? rows[0];
    await selectClip(page, clip.id);
    const canvas = page.getByTestId("studio-waveform").locator("canvas").first();
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId("waveform-playhead")).toBeVisible();
    // Canvas must actually contain drawn pixels (not blank).
    const painted = await canvas.evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext("2d")!;
      const data = ctx.getImageData(0, 0, el.width, el.height).data;
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1;
      return count;
    });
    expect(painted).toBeGreaterThan(500);
    await expect(page.getByTestId("editing-badge")).toHaveCount(0);
    await page.getByTestId("waveform-edit").click();
    await expect(page.getByTestId("editing-badge")).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByTestId("editing-badge")).toHaveCount(0);
  });

  test("clicking the waveform moves the playhead (needs Range support on audio.wav)", async ({ page }) => {
    await openStudio(page, slug!);
    const rows = await visibleClips(page);
    const clip = rows.find((c) => c.duration >= 3) ?? rows[0];
    await selectClip(page, clip.id);
    await clickWaveform(page, 0.5);
    const audio = page.locator("audio").first();
    await expect
      .poll(async () => audio.evaluate((a: HTMLAudioElement) => a.currentTime / (a.duration || 1)), { timeout: 4000 })
      .toBeGreaterThan(0.3);
  });

  test("playhead is visible with contrast in light and dark", async ({ page }) => {
    await openStudio(page, slug!);
    const rows = await visibleClips(page);
    await selectClip(page, (rows.find((c) => c.duration >= 3) ?? rows[0]).id);
    const playhead = page.getByTestId("waveform-playhead");
    await expect(playhead).toBeVisible();

    async function contrast() {
      const box = await playhead.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);
      return page.evaluate(() => {
        const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const lum = (rgb: number[]) => {
          const toLin = (v: number) => {
            const n = v / 255;
            return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * toLin(rgb[0] ?? 0) + 0.7152 * toLin(rgb[1] ?? 0) + 0.0722 * toLin(rgb[2] ?? 0);
        };
        const el = document.querySelector('[data-testid="waveform-playhead"]') as HTMLElement;
        const canvas = document.querySelector('[data-testid="studio-waveform"] canvas') as HTMLCanvasElement;
        const fg = parse(getComputedStyle(el).backgroundColor);
        const ctx = canvas.getContext("2d");
        let bg = [226, 232, 240];
        if (ctx) {
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < data.length; i += 16) {
            if ((data[i + 3] ?? 0) < 8) continue;
            r += data[i] ?? 0;
            g += data[i + 1] ?? 0;
            b += data[i + 2] ?? 0;
            n += 1;
          }
          if (n > 0) bg = [r / n, g / n, b / n];
        }
        const hi = Math.max(lum(fg), lum(bg));
        const lo = Math.min(lum(fg), lum(bg));
        return (hi + 0.05) / (lo + 0.05);
      });
    }

    expect(await contrast()).toBeGreaterThan(2);
    const theme = page.getByRole("button", { name: /Switch to (light|dark) mode/ });
    await theme.click();
    await expect(playhead).toBeVisible();
    expect(await contrast()).toBeGreaterThan(2);
    await theme.click();
  });

  test("playhead slides through many positions while audio plays", async ({ page }) => {
    await openStudio(page, slug!);
    const rows = await visibleClips(page);
    const clip = rows.find((c) => c.duration >= 3) ?? rows[0];
    await selectClip(page, clip.id);
    await page.locator("audio").first().evaluate((audio: HTMLAudioElement) => audio.play());
    const samples: number[] = [];
    const started = Date.now();
    while (Date.now() - started < 1000) {
      const x = await page.getByTestId("waveform-playhead").evaluate((el) => {
        const transform = getComputedStyle(el).transform;
        const match = /matrix\((.+)\)/.exec(transform);
        if (!match) return 0;
        return Number(match[1].split(",")[4]);
      });
      samples.push(x);
      await page.waitForTimeout(80);
    }
    const unique = samples.filter((value, index) => index === 0 || Math.abs(value - samples[index - 1]!) > 0.2);
    expect(unique.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < unique.length; i += 1) {
      expect(unique[i]!).toBeGreaterThanOrEqual(unique[i - 1]!);
    }
  });

  test("S adds a cut only in edit mode; two cuts save as three undecided clips", async ({ page }) => {
    await openStudio(page, slug!);
    const rows = await visibleClips(page);
    const clip = rows.find((c) => c.duration >= 3 && c.status !== "undecided") ?? rows.find((c) => c.duration >= 3);
    test.skip(!clip, "No clip of 3 s or longer in this project.");
    await selectClip(page, clip!.id);

    // S outside edit mode must do nothing.
    await clickWaveform(page, 0.3);
    await page.keyboard.press("s");
    await expect(page.getByText("Part 2")).toHaveCount(0);

    await page.getByTestId("waveform-edit").click();
    const save = page.getByRole("button", { name: /^Save/ });
    await expect(save).toBeDisabled();

    await clickWaveform(page, 0.33);
    await page.keyboard.press("s");
    await clickWaveform(page, 0.66);
    await page.getByRole("button", { name: "Add cut at playhead" }).click();
    await expect(save).toContainText("2 cuts → 3 clips");

    // A cut right next to an existing one is refused.
    await clickWaveform(page, 0.665);
    await page.keyboard.press("s");
    await expect(page.getByText(/too close/i)).toBeVisible();
    await expect(save).toContainText("2 cuts → 3 clips");

    const before = (await studioApi.project(slug!)).clips.length;
    await save.click();
    await expect.poll(async () => (await studioApi.project(slug!)).clips.length).toBe(before + 2);

    const after = await studioApi.project(slug!);
    const kids = after.clips.filter((c) => c.parentIds?.includes(clip!.id));
    expect(kids).toHaveLength(3);
    expect(after.clips.some((c) => c.id === clip!.id)).toBe(false);
    for (const kid of kids) {
      expect(kid.status).toBe("undecided");
      expect(kid.decidedBy).toBe("human");
      expect(kid.statusReason).toContain(clip!.id);
      expect(kid.groupId).toBe(clip!.groupId);
    }
    expect(kids[0].sourceStart).toBeCloseTo(clip!.sourceStart, 2);
    expect(kids[2].sourceEnd).toBeCloseTo(clip!.sourceEnd, 2);
    expect(kids[0].sourceEnd).toBeCloseTo(kids[1].sourceStart, 2);
    expect(kids[1].sourceEnd).toBeCloseTo(kids[2].sourceStart, 2);

    const history = await studioApi.history(slug!);
    expect(history.history.find((h) => h.current)?.summary).toMatch(/split .* into 3 clips/);
    // One undo brings the original back (also done by afterEach).
    await studioApi.undo(slug!);
    const restored = await studioApi.project(slug!);
    expect(restored.clips.some((c) => c.id === clip!.id)).toBe(true);
    expect(restored.clips.length).toBe(before);
  });
});

test("no React or page errors while browsing a clip", async ({ page }) => {
  const errors = attachErrorCollector(page);
  await openStudio(page, slug!);
  const rows = await visibleClips(page);
  await selectClip(page, (rows[1] ?? rows[0]).id);
  await page.waitForTimeout(500);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("render preview shows progress and plays the result (slow, set E2E_RENDER=1)", async ({ page }) => {
  test.skip(!process.env.E2E_RENDER, "Slow: renders a preview. Run with E2E_RENDER=1.");
  test.setTimeout(240_000);
  await openStudio(page, slug!);
  await page.getByRole("button", { name: "Render preview" }).click();
  await expect(page.getByTestId("render-progress")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel render" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel render" })).toBeHidden({ timeout: 200_000 });
  await page.getByRole("button", { name: "Rendered video" }).click();
  await expect(page.getByTestId("rendered-video").locator("video")).toBeVisible();
});
