import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"

it("reports F4 BLOCKED without private two-book evidence or authorized access", () => {
  const directory = mkdtempSync(join(tmpdir(), "ten1-f4-"))
  try {
    const reportPath = join(directory, "report.json")
    const result = spawnSync(
      process.execPath,
      ["--experimental-transform-types", "apps/worker/scripts/providers-live-smoke.ts"],
      {
        env: {
          ...process.env,
          OPENAI_API_KEY: "",
          OPENROUTER_API_KEY: "",
          ANTHROPIC_API_KEY: "",
          LIVE_SMOKE_CONSENT: "yes",
          LIVE_SMOKE_REPORT: reportPath,
          STUDIO_CODEX_BINARY: "/nonexistent/codex",
        },
        encoding: "utf8",
        timeout: 30000,
      },
    )
    expect(result.status).toBe(2)
    expect(JSON.parse(readFileSync(reportPath, "utf8"))).toMatchObject({
      status: "BLOCKED",
      callCount: 0,
      f4: { status: "BLOCKED", sourceCheckedBooks: 0 },
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
