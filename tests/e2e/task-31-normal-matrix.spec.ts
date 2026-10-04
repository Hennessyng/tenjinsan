import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, expect, test } from "@playwright/test"
import { startComposeMatrix, startLocalMatrix } from "../deployment/matrix-deployments.ts"
import { runMatrix } from "../deployment/matrix-driver.ts"

const evidenceRoot = ".omo/evidence/reading-studio/task-31-matrix-2026-09-26/runs"

for (const mode of ["local", "compose"] as const) {
  test(`normal ${mode} deployment rejects failures through owner browser and persisted jobs`, async ({
    browser,
  }) => {
    test.setTimeout(mode === "compose" ? 900_000 : 300_000)
    const runId = randomUUID()
    const runDir = join(evidenceRoot, runId)
    await mkdir(runDir, { recursive: true })
    const isolated =
      mode === "compose"
        ? await chromium.launch({ args: ["--proxy-bypass-list=<-loopback>"] })
        : null
    let deployment: Awaited<ReturnType<typeof startLocalMatrix>> | undefined
    try {
      deployment =
        mode === "local"
          ? await startLocalMatrix(browser)
          : await startComposeMatrix(isolated ?? browser)
      const cases = await runMatrix(deployment.deployment)
      expect(cases.map((item) => item.name)).toEqual([
        "corrupt-epub",
        "expired-session",
        "malformed-output",
        "invalid-citation",
        "cross-provider",
        "privacy-canary",
        "renderer-failure",
        "forged-downloaded-html",
        "destination-owner-restore",
        "accepted-crash",
        "cancelled-stale-revision",
      ])
      const serializedEvidence = JSON.stringify({ runId, mode, cases }, null, 2)
      const sensitiveField = [...serializedEvidence.matchAll(/"([^"]+)"\s*:/g)].find(
        (match) =>
          match[1] !== "wrongPassphraseRejected" &&
          /password|passphrase|credentialHash|privateBlobHashes|encryptedHash|manifestHash|sourceText|sourceHtml|prompt|responseBody|rawHtml|htmlContent|htmlBytes/i.test(
            match[1] ?? "",
          ),
      )?.[1]
      expect(sensitiveField ?? null).toBeNull()
      await writeFile(join(runDir, "matrix.json"), serializedEvidence)
      await writeFile(
        join(runDir, "run.log"),
        `${cases
          .map(
            (item) =>
              `${item.name}: HTTP ${item.http}; job ${item.job ?? "none"}; persisted jobs ${item.lineage.setup?.jobs.length ?? 0}`,
          )
          .join("\n")}\n`,
      )
      await writeFile(
        join(runDir, "report.md"),
        [
          `# Normal ${mode} Task31 matrix ${runId}`,
          "",
          "Real owner browser, API, worker, loopback wire, and persisted SQLite. No fixture-mode stage or live provider.",
          "",
          "| Case | Public HTTP | Persisted job | Attempts |",
          "|---|---:|---|---|",
          ...cases.map(
            (item) =>
              `| ${item.name} | ${item.http} | ${item.job ?? "none"} | ${item.attempts?.join(", ") ?? "none"} |`,
          ),
          "",
          "`matrix.json` contains exact run/setup/grant/attempt/cache/output IDs and sanitized statuses, not prompts, private source, provider responses, lease tokens or credentials.",
          "",
          "The forged downloaded HTML is refused at public request boundaries or ignored as a non-authoritative generation body; this is not an HTML import feature. A separate provisioned owner receives only the age ciphertext through TTY CLI transfer, while historical grants and publication releases remain inert.",
          "",
        ].join("\n"),
      )
    } finally {
      await deployment?.stop()
      await isolated?.close()
    }
  })
}
