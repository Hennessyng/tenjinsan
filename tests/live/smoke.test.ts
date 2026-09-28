import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, test } from "vitest"

test("Given no credential or consent, when live smoke runs, then it reports BLOCKED without a provider call", () => {
  const directory = mkdtempSync(join(tmpdir(), "reading-live-"))
  try {
    const report = join(directory, "smoke.json")
    const result = spawnSync(
      process.execPath,
      ["--experimental-transform-types", "apps/worker/scripts/providers-live-smoke.ts"],
      {
        cwd: resolve(import.meta.dirname, "../.."),
        env: {
          ...process.env,
          OPENAI_API_KEY: "",
          ANTHROPIC_API_KEY: "",
          LIVE_SMOKE_CONSENT: "",
          LIVE_SMOKE_REPORT: report,
        },
        encoding: "utf8",
        timeout: 30_000,
      },
    )
    expect(result.status).toBe(2)
    expect(result.stdout).not.toContain("passed")
    expect(JSON.parse(readFileSync(report, "utf8"))).toMatchObject({
      status: "BLOCKED",
      callCount: 0,
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("Given credential names but no consent, when live smoke runs, then it still reports BLOCKED", () => {
  const directory = mkdtempSync(join(tmpdir(), "reading-live-"))
  try {
    const report = join(directory, "smoke.json")
    const result = spawnSync(
      process.execPath,
      ["--experimental-transform-types", "apps/worker/scripts/providers-live-smoke.ts"],
      {
        cwd: resolve(import.meta.dirname, "../.."),
        env: {
          ...process.env,
          OPENAI_API_KEY: "synthetic-not-a-real-key",
          ANTHROPIC_API_KEY: "",
          LIVE_SMOKE_CONSENT: "",
          LIVE_SMOKE_REPORT: report,
        },
        encoding: "utf8",
        timeout: 30_000,
      },
    )
    expect(result.status).toBe(2)
    expect(JSON.parse(readFileSync(report, "utf8"))).toMatchObject({
      status: "BLOCKED",
      callCount: 0,
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
