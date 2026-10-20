import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "../../apps/worker/tests",
  testMatch: "ten23-*.browser.ts",
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: "list",
  outputDir: "../../.sisyphus/runs/TEN-23/browser-results",
  use: {
    browserName: "chromium",
    launchOptions: process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"]
      ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"] }
      : {},
    trace: "retain-on-failure",
  },
})
