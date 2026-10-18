import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: "ten19-*.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  reporter: "list",
  use: { browserName: "chromium", trace: "retain-on-failure" },
})
