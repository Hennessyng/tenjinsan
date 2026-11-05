import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: "ten29-full-book.spec.ts",
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: "list",
  outputDir: "../../.sisyphus/runs/TEN-29/full-book-ui-browser",
  use: { browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command:
      "../../node_modules/.bin/vite build && ../../node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort",
    cwd: "../../apps/studio",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120000,
  },
})
