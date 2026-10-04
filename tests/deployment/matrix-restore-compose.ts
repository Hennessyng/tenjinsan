import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type Browser, type BrowserContext, expect } from "@playwright/test"
import { z } from "zod"
import { workspaceRoot } from "./local-fixture.ts"
import { provisionComposeMatrixOwner } from "./matrix-compose-owner.ts"
import { proxyToPort } from "./matrix-proxy.ts"
import { assertRestoredLibrary, type RestoreTargets, runAgeTransfer } from "./matrix-restore.ts"
import { RestoreInspection } from "./matrix-restore-inspect.ts"

export async function restoreComposeMatrix(
  browser: Browser,
  sourceProject: string,
  sourceEnvironment: NodeJS.ProcessEnv,
  targets: RestoreTargets,
) {
  const destinationProject = `matrix-dest-${randomUUID().slice(0, 8)}`
  const environment: NodeJS.ProcessEnv = {
    ...sourceEnvironment,
    AUTH_SECRET: "matrix-destination-secret-at-least-32-characters",
    OPENAI_API_KEY: "",
    OPENROUTER_API_KEY: "",
    ANTHROPIC_API_KEY: "",
  }
  const sourcePrefix = [
    "compose",
    "-p",
    sourceProject,
    "-f",
    "deploy/compose.yml",
    "-f",
    "tests/deployment/compose-wire.yml",
    "-f",
    "tests/deployment/compose-matrix.yml",
  ]
  const destinationPrefix = [
    "compose",
    "-p",
    destinationProject,
    "-f",
    "deploy/compose.yml",
    "-f",
    "tests/deployment/compose-matrix-destination.yml",
  ]
  const compose = (prefix: readonly string[], env: NodeJS.ProcessEnv, args: readonly string[]) =>
    execFileSync("docker", [...prefix, ...args], {
      cwd: workspaceRoot,
      env,
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 8 * 1024 * 1024,
    }).trim()
  const inspect = (prefix: readonly string[], env: NodeJS.ProcessEnv) =>
    RestoreInspection.parse(
      JSON.parse(
        compose(prefix, env, [
          "exec",
          "-T",
          "api",
          "node",
          "--experimental-transform-types",
          "tests/deployment/matrix-restore-inspect.ts",
        ]),
      ),
    )
  const source = inspect(sourcePrefix, sourceEnvironment)
  const bridge = await mkdtemp(join(tmpdir(), "matrix-age-bridge-"))
  let proxy: Awaited<ReturnType<typeof proxyToPort>> | undefined
  let context: BrowserContext | undefined
  let freshContext: BrowserContext | undefined
  try {
    expect(sourceProject).not.toBe(destinationProject)
    compose(destinationPrefix, environment, ["config", "--quiet"])
    compose(destinationPrefix, environment, ["build"])
    provisionComposeMatrixOwner(destinationPrefix, environment, true)
    compose(destinationPrefix, environment, ["up", "-d", "--wait", "--wait-timeout", "120"])
    for (const role of ["api", "worker"])
      compose(destinationPrefix, environment, [
        "exec",
        "-T",
        role,
        "node",
        "-e",
        "if ('STUDIO_SYNTHETIC_TEST_MODE' in process.env) process.exit(2)",
      ])
    const sourceVolume = execFileSync(
      "docker",
      ["volume", "inspect", "-f", "{{.Name}}", `${sourceProject}_private-data`],
      { cwd: workspaceRoot, env: environment, encoding: "utf8" },
    ).trim()
    const destinationVolume = execFileSync(
      "docker",
      ["volume", "inspect", "-f", "{{.Name}}", `${destinationProject}_private-data`],
      { cwd: workspaceRoot, env: environment, encoding: "utf8" },
    ).trim()
    expect(destinationVolume).not.toBe(sourceVolume)
    const before = inspect(destinationPrefix, environment)
    const binding = compose(destinationPrefix, environment, ["port", "proxy", "443"])
    const port = Number(binding.split(":").at(-1))
    if (!Number.isInteger(port)) throw new TypeError("Destination proxy binding missing")
    proxy = await proxyToPort(port)
    context = await browser.newContext({ proxy: { server: proxy.url }, ignoreHTTPSErrors: true })
    const page = await context.newPage()
    const origin = "https://localhost"
    await page.goto(`${origin}/login`)
    await page.getByLabel("Email").fill("destination-owner@example.test")
    await page.getByLabel("Password").fill("correct horse battery staple")
    await page.getByRole("button", { name: "Log in" }).click()
    await expect(page.locator("#root")).toBeVisible()
    const destinationSessionCookie = (await context.cookies(origin)).find((cookie) =>
      cookie.name.endsWith("better-auth.session_token"),
    )?.value
    expect(destinationSessionCookie).toBeTruthy()
    expect(destinationSessionCookie).not.toBe(targets.sourceSessionCookie)
    const archive = runAgeTransfer(
      ["compose", join(bridge, "matrix-library.age"), sourceProject, destinationProject],
      sourceEnvironment,
    )
    const restored = inspect(destinationPrefix, environment)
    assertRestoredLibrary({ source, before, restored, archive })
    expect(
      JSON.stringify(inspect(sourcePrefix, sourceEnvironment)) === JSON.stringify(source),
    ).toBe(true)
    const current = await page.request.get(`${origin}/api/publications/${targets.studyId}`)
    expect(current.status()).toBe(200)
    z.object({ history: z.array(z.unknown()).length(0) }).parse(await current.json())
    const generation = await page.request.post(
      `${origin}/api/publications/${targets.studyId}/outputs/${targets.publicationId}`,
      { data: {}, headers: { origin } },
    )
    expect(generation.status()).toBe(404)
    const download = await page.request.get(`${origin}/publication-artifacts/${targets.outputId}`)
    expect(download.status()).toBe(404)
    const ledger = await page.request.get(`${origin}/api/study-jobs`)
    expect(ledger.status()).toBe(200)
    expect(
      z
        .object({ jobs: z.array(z.object({ state: z.string() })).length(0) })
        .parse(await ledger.json()).jobs,
    ).toEqual([])
    freshContext = await browser.newContext({
      proxy: { server: proxy.url },
      ignoreHTTPSErrors: true,
    })
    const freshPage = await freshContext.newPage()
    await freshPage.goto(`${origin}/login`)
    await freshPage.getByLabel("Email").fill("destination-owner@example.test")
    await freshPage.getByLabel("Password").fill("correct horse battery staple")
    await freshPage.getByRole("button", { name: "Log in" }).click()
    await expect(freshPage.locator("#root")).toBeVisible()
    const fresh = await freshPage.request.get(`${origin}/api/publications/${targets.studyId}`)
    expect(fresh.status()).toBe(200)
    return {
      archive,
      destinationOwnerId: restored.owner.id,
      restoredStudies: restored.studies.length,
      pausedJobs: restored.jobs.length,
      historicalGrants: restored.grants.length,
      verifiedBlobCount: restored.blobs.length,
      allBlobsMatched: true as const,
      destinationCredentialPreserved: true as const,
      publicStudyHttp: current.status(),
      historicalGenerationHttp: generation.status(),
      historicalDownloadHttp: download.status(),
      activeSessionHttp: ledger.status(),
      freshLoginHttp: fresh.status(),
      separateStorage: true,
      sessionCookiesDistinct: true,
      wrongPassphraseRejected: true,
      corruptCiphertextRejected: true,
    }
  } finally {
    await freshContext?.close()
    await context?.close()
    await proxy?.close()
    try {
      compose(destinationPrefix, environment, ["down", "--volumes", "--remove-orphans"])
    } finally {
      await rm(bridge, { recursive: true, force: true })
    }
  }
}
