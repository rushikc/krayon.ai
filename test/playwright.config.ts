import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests for Krayon Studio. They run against the dev servers you already
 * have up (`pnpm dev`): Vite on 5173, studio backend on 8789 and the Python audio
 * backend on 8000. See test/README.md.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "../tmp/playwright-results",
  reporter: [["list"], ["html", { outputFolder: "../tmp/playwright-report", open: "never" }]],
  timeout: 40_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalSetup: "./helpers/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    // Uses the Google Chrome already installed on the machine, so no browser download.
    channel: process.env.E2E_CHANNEL ?? "chrome",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 10_000,
  },
});
