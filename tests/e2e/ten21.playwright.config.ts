import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: ["ten21-subscriptions.spec.ts", "ten21-tool-managed-send.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: "list",
  outputDir: "../../.omo/evidence/TEN-21/offline/results",
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
})
