import { ProviderError } from "@reading-studio/providers"
import { openStorage } from "@reading-studio/storage"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import * as preparation from "./study-preparation.ts"
import { sourceViewerFixture } from "./testing/source-viewer-fixture.ts"

const fixtures: Awaited<ReturnType<typeof sourceViewerFixture>>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) await fixture.close()
})
async function draft(fixture: Awaited<ReturnType<typeof sourceViewerFixture>>) {
  fixtures.push(fixture)
  const headers = { origin: fixture.origin, "content-type": "application/json" }
  const response = await fetch(`${fixture.origin}/api/study-setup/revision-fixture`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider: "anthropic" }),
  })
  const { setupId } = z.object({ setupId: z.string() }).parse(await response.json())
  const url = `${fixture.origin}/api/study-setup/revision-fixture/${setupId}`
  const send = (decision = "send") =>
    fetch(url, { method: "POST", headers, body: JSON.stringify({ decision }) })
  return { headers, url, send, setupId }
}

it("preserves a provider refusal through replay and granted reload without another scheduling request", async () => {
  // Given
  const schedule = vi.fn(() => {
    throw new ProviderError("unsupported-model")
  })
  const fixture = await sourceViewerFixture({ onSetupSend: schedule })
  const { send, url } = await draft(fixture)
  // When
  const saved = await send()
  const replay = await send()
  const reload = await fetch(url)
  // Then
  expect(await saved.json()).toMatchObject({
    schedulingFailure: "unsupported-model",
    canResume: false,
  })
  expect(await replay.json()).toMatchObject({
    schedulingFailure: "unsupported-model",
    canResume: false,
  })
  expect(await reload.json()).toMatchObject({
    schedulingFailure: "unsupported-model",
    canResume: false,
  })
  expect(schedule).toHaveBeenCalledTimes(1)
  expect(fixture.storage.counts()).toMatchObject({ grants: 1, jobs: 0, attempts: 0 })
})

it("rechecks provider availability before resuming saved but unscheduled consent", async () => {
  // Given
  let available = true
  const schedule = vi.fn(() => {
    throw new TypeError("Synthetic scheduling interruption")
  })
  const fixture = await sourceViewerFixture({
    onSetupSend: schedule,
    providerAvailable: () => available,
  })
  const { send, url } = await draft(fixture)
  await send()
  available = false
  // When
  const resumed = await send("resume")
  // Then
  expect(resumed.status).toBe(200)
  expect(await resumed.json()).toMatchObject({
    schedulingFailure: "provider-unavailable",
    canResume: false,
  })
  expect(await (await fetch(url)).json()).toMatchObject({
    schedulingFailure: "provider-unavailable",
    canResume: false,
  })
  expect(schedule).toHaveBeenCalledTimes(1)
  expect(fixture.storage.counts()).toMatchObject({ grants: 1, jobs: 0, attempts: 0 })
})

it("retains a sanitized scheduling refusal when the database is reopened", async () => {
  // Given
  const fixture = await sourceViewerFixture({
    onSetupSend: () => {
      throw new ProviderError("unsupported-settings")
    },
  })
  const { send, setupId } = await draft(fixture)
  await send()
  // When
  const reopened = openStorage({
    databasePath: fixture.databasePath,
    privateDataRoot: fixture.privateDataRoot,
  })
  // Then
  try {
    expect(reopened.setupScheduling.failure(`grant-${setupId}`)).toBe("unsupported-settings")
  } finally {
    reopened.close()
  }
})

it.each(["cancel", "revise"])(
  "keeps an HTML conflict response for %s after saved consent",
  async (decision) => {
    // Given
    const fixture = await sourceViewerFixture()
    const { send, setupId } = await draft(fixture)
    await send()
    // When
    const response = await fetch(`${fixture.origin}/sources/revision-fixture/setup/${setupId}`, {
      method: "POST",
      headers: { origin: fixture.origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ decision }),
    })
    // Then
    expect(response.status).toBe(409)
    expect(response.headers.get("content-type")).toContain("text/html")
  },
)

it.each(["en", "ja"])(
  "uses a consent-only heading for an unscheduled HTML result in %s",
  async (language) => {
    // Given
    const fixture = await sourceViewerFixture()
    const { setupId } = await draft(fixture)
    // When
    const response = await fetch(
      `${fixture.origin}/sources/revision-fixture/setup/${setupId}?lang=${language}`,
      {
        method: "POST",
        headers: { origin: fixture.origin, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ decision: "send" }),
      },
    )
    // Then
    const html = await response.text()
    expect(html).toContain(language === "en" ? "Consent saved" : "同意を保存しました")
    expect(html).not.toContain(language === "en" ? "Transmission approved" : "送信を承認しました")
  },
)

it("serializes duplicate Send acceptance when both requests passed the empty-grant check", async () => {
  // Given
  const schedule = vi.fn()
  const fixture = await sourceViewerFixture({ onSetupSend: schedule })
  const { send } = await draft(fixture)
  const reached = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let arrivals = 0
  const original = preparation.preflightStudyDecision
  vi.spyOn(preparation, "preflightStudyDecision").mockImplementation(async (context, input) => {
    const result = await original(context, input)
    arrivals += 1
    if (arrivals === 2) reached.resolve()
    await release.promise
    return result
  })
  // When
  const replies = Promise.all([send(), send()])
  try {
    await reached.promise
  } finally {
    release.resolve()
  }
  const results = await replies
  // Then
  expect(arrivals).toBe(2)
  expect(results.map((response) => response.status)).toEqual([200, 200])
  expect(await results[0]?.json()).toEqual(await results[1]?.json())
  expect(schedule).toHaveBeenCalledTimes(1)
  expect(fixture.storage.counts()).toMatchObject({ grants: 1, jobs: 0, attempts: 0 })
})
