import { writeFileSync } from "node:fs"
import { chromium } from "@playwright/test"
import { runWorkerProcess } from "./index.ts"

const browser = await chromium.launch({ channel: "chromium", chromiumSandbox: true })
try {
  const page = await browser.newPage()
  await page.goto("chrome://sandbox")
  const status = await page.locator("body").innerText()
  if (
    !/Layer 1 Sandbox\s+Namespace/.test(status) ||
    !/PID namespaces\s+Yes/.test(status) ||
    !/Network namespaces\s+Yes/.test(status) ||
    !/Seccomp-BPF sandbox\s+Yes/.test(status)
  ) {
    throw new TypeError("Chromium namespace and seccomp sandboxes must be active")
  }
} finally {
  await browser.close()
}
writeFileSync("/tmp/worker-ready", "ready\n")
const heartbeat = setInterval(() => writeFileSync("/tmp/worker-ready", "ready\n"), 5_000)
try {
  await runWorkerProcess()
} finally {
  clearInterval(heartbeat)
}
