import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { sourceViewerFixture } from "./testing/source-viewer-fixture.ts"

const resources: {
  readonly fixture: Awaited<ReturnType<typeof sourceViewerFixture>>
  readonly directory: string
}[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const { fixture, directory } of resources.splice(0)) {
    await fixture.close()
    await rm(directory, { recursive: true, force: true })
  }
})

async function savedSubscription() {
  const directory = await mkdtemp(join(tmpdir(), "ten25-resume-"))
  const binary = join(directory, "tool-fixture")
  await writeFile(
    binary,
    `#!/bin/sh\nexec "${process.execPath}" "${resolve("packages/storage/tests/subscription-execution-fixture.cjs")}" kind:codex "$@"\n`,
    { mode: 0o700 },
  )
  vi.stubEnv("STUDIO_SUBSCRIPTION_CODEX_BINARY", binary)
  const schedule = vi.fn(() => {
    throw new TypeError("Synthetic scheduling interruption")
  })
  const fixture = await sourceViewerFixture({ serverHost: "127.0.0.1", onSetupSend: schedule })
  resources.push({ fixture, directory })
  const owner = fixture.storage.sources.listStudiesByEdition("edition-fixture")[0]
  if (!owner) throw new TypeError("Synthetic owner missing")
  const installation =
    fixture.storage.sources.getInstallation(owner.ownerId) ??
    fixture.storage.sources.createInstallation({
      id: "fixture-installation",
      ownerId: owner.ownerId,
    })
  await fixture.storage.subscriptionLogin.connect(installation)
  await fixture.storage.subscriptionLogin.settled(installation)
  const headers = { origin: fixture.origin, "content-type": "application/json" }
  const draft = await fetch(`${fixture.origin}/api/study-setup/revision-fixture`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider: "chatgpt-subscription", model: "study-model" }),
  })
  const { setupId } = z.object({ setupId: z.string() }).parse(await draft.json())
  const url = `${fixture.origin}/api/study-setup/revision-fixture/${setupId}`
  const accepted = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "send" }),
  })
  expect(accepted.status).toBe(200)
  return { fixture, installation, headers, url, schedule }
}

it.each(["forwarded", "disconnected", "model-removed"])(
  "refuses subscription resume after %s without another scheduling invocation",
  async (mode) => {
    // Given
    const { fixture, installation, headers, url, schedule } = await savedSubscription()
    const refresh = vi.spyOn(fixture.storage.subscriptionLogin, "refresh")
    if (mode === "disconnected")
      fixture.storage.subscriptionConnections.disconnect(installation, "chatgpt-subscription")
    if (mode === "model-removed") {
      const status = fixture.storage.subscriptionLogin.status.bind(
        fixture.storage.subscriptionLogin,
      )
      vi.spyOn(fixture.storage.subscriptionLogin, "status").mockImplementation((id) => ({
        ...status(id),
        models: [],
      }))
    }
    const code =
      mode === "forwarded"
        ? "local-only"
        : mode === "disconnected"
          ? "subscription-connection-changed"
          : "unsupported-model"
    const reviewed = await fetch(url, {
      headers: mode === "forwarded" ? { "x-forwarded-for": "192.0.2.1" } : {},
    })
    expect(await reviewed.json()).toMatchObject({ schedulingFailure: code, canResume: false })
    const replay = await fetch(url, {
      method: "POST",
      headers: { ...headers, ...(mode === "forwarded" ? { "x-forwarded-for": "192.0.2.1" } : {}) },
      body: JSON.stringify({ decision: "send" }),
    })
    expect(await replay.json()).toMatchObject({ schedulingFailure: code, canResume: false })
    expect(schedule).toHaveBeenCalledTimes(1)
    // When
    const response = await fetch(url, {
      method: "POST",
      headers: { ...headers, ...(mode === "forwarded" ? { "x-forwarded-for": "192.0.2.1" } : {}) },
      body: JSON.stringify({ decision: "resume" }),
    })
    // Then
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ schedulingFailure: code, canResume: false })
    expect(await (await fetch(url)).json()).toMatchObject({
      schedulingFailure: code,
      canResume: false,
    })
    expect(schedule).toHaveBeenCalledTimes(1)
    if (mode === "model-removed") expect(refresh).toHaveBeenCalledTimes(1)
    expect(fixture.storage.counts()).toMatchObject({ grants: 1, attempts: 0, jobs: 0 })
  },
)
