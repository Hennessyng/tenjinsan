import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: ["ten-18-import.spec.ts", "ten-18-preparation.spec.ts"],
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
})
