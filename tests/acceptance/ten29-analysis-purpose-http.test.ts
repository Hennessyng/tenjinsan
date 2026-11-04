import { createApp } from "@reading-studio/server/app"
import { studySetupSend } from "@reading-studio/server/study-setup-send"
import { afterEach, expect, it } from "vitest"
import { sourceViewerFixture } from "../../apps/server/src/testing/source-viewer-fixture.ts"
import { analysisPurposeFixture } from "../../apps/worker/tests/analysis-purpose-fixture.ts"
import {
  bookFixtureAuthority,
  bookFixtureCapacity,
  bookFixtureTurns,
} from "../../apps/worker/tests/book-map-route-fixture.ts"

const fixtures: Awaited<ReturnType<typeof analysisPurposeFixture>>[] = []
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.fixture.close()
})
const origin = "http://127.0.0.1:8787"
function app(item: Awaited<ReturnType<typeof analysisPurposeFixture>>) {
  bookFixtureAuthority(item.fixture)
  return createApp({
    serverHost: "127.0.0.1",
    reviewStorage: item.fixture.storage,
    sources: item.fixture.storage.sources,
    libraryOwnerId: "owner-1",
    bookMapCapacity: bookFixtureCapacity,
    onSetupSend: studySetupSend(item.fixture.storage, true, {
      localSubscriptions: true,
      capacity: bookFixtureCapacity,
    }),
    security: {
      trustedOrigins: [origin],
      trustProxy: false,
      apiBodyBytes: 8192,
      loginBodyBytes: 4096,
      loginRateLimit: { attempts: 5, windowMs: 60000 },
      uploadBodyBytes: 8192,
    },
  })
}
const request = {
  method: "POST",
  headers: { origin, "content-type": "application/json" },
  body: JSON.stringify({ decision: "send" }),
}
it("creates narrow consent only on explicit Send under the matching controlled target", async () => {
  const item = await analysisPurposeFixture(false)
  fixtures.push(item)
  const server = app(item),
    url = `${origin}/api/study-setup/${item.normalization.id}/${item.setup.id}`
  expect(item.fixture.storage.sources.getGrant(item.grant.id)).toBeNull()
  expect(await (await server.request(url)).json()).toMatchObject({
    preparation: {
      purpose: item.setup.analysis.purpose,
      purposeTargetBound: true,
      batchedMaximum: { maxTotalAttempts: 18, reservedLaterAttempts: 0 },
    },
  })
  expect((await server.request(url, request)).status).toBe(200)
  const saved = item.fixture.storage.sources.getGrant(item.grant.id)
  expect(saved?.categories).toEqual(["book-text", "derived-study-material"])
  expect(saved?.purpose).toEqual(item.setup.analysis.purpose)
  expect(item.fixture.storage.execution.listSetupJobs(item.setup.id)).toHaveLength(1)
  const before = item.fixture.storage.counts()
  expect((await server.request(url, request)).status).toBe(200)
  expect(item.fixture.storage.counts()).toEqual(before)
  expect(bookFixtureTurns(item.fixture)).toHaveLength(0)
})
it("cannot Send on an unbound ordinary API instance or convert the purpose implicitly", async () => {
  const item = await analysisPurposeFixture(false)
  fixtures.push(item)
  await item.reopen(false)
  const server = app(item),
    url = `${origin}/api/study-setup/${item.normalization.id}/${item.setup.id}`,
    before = item.fixture.storage.counts()
  expect((await server.request(url, request)).status).toBe(409)
  expect(item.fixture.storage.counts()).toEqual(before)
  const changed = await server.request(`${origin}/api/study-setup/${item.normalization.id}`, {
    ...request,
    body: JSON.stringify({ provider: "chatgpt-subscription", model: "study-model" }),
  })
  expect(changed.status).toBe(409)
  expect(item.fixture.storage.sources.getLatestSetup(item.setup.studyId)).toEqual(item.setup)
  expect(item.fixture.storage.counts()).toEqual(before)
})
it("persists verified-analysis on reload with no resume or question URL", async () => {
  const item = await analysisPurposeFixture()
  fixtures.push(item)
  const run = item.runtime()
  let value = run.pipeline.prepare(item.setup.id, item.grant.id)
  for (let step = 0; step < 10 && value.status !== "successful"; step++) {
    await run.worker.runNext()
    value = run.pipeline.prepare(item.setup.id, item.grant.id)
  }
  const response = await app(item).request(
    `${origin}/api/study-setup/${item.normalization.id}/${item.setup.id}`,
  )
  const saved: unknown = await response.json()
  expect(saved).toMatchObject({
    decision: "send",
    terminal: "verified-analysis",
    canResume: false,
    purpose: item.setup.analysis.purpose,
  })
  expect(saved).not.toHaveProperty("questionsUrl")
})
it.each(["revise", "cancel"] as const)(
  "keeps evaluation purpose and source allowance immutable after direct %s and refused new drafts",
  async (decision) => {
    const item = await analysisPurposeFixture(false)
    fixtures.push(item)
    const server = app(item),
      url = `${origin}/api/study-setup/${item.normalization.id}/${item.setup.id}`
    const budget = item.fixture.storage.liveStudyGuard.sharedStatus(item.setup.id)
    expect(budget).not.toBeNull()
    const response = await server.request(url, { ...request, body: JSON.stringify({ decision }) })
    expect(response.status).toBe(200)
    expect(item.fixture.storage.sources.getGrant(item.grant.id)?.kind).toBe("revoked")
    for (const purpose of [undefined, "analysis-evaluation-1"]) {
      const draft = await server.request(`${origin}/api/study-setup/${item.normalization.id}`, {
        ...request,
        body: JSON.stringify({
          provider: "chatgpt-subscription",
          model: "study-model",
          ...(purpose ? { purpose } : {}),
        }),
      })
      expect(draft.status).toBe(409)
      expect(await draft.json()).toMatchObject({
        error: "analysis-purpose-requires-fresh-study",
        transmission: "not-sent",
      })
    }
    expect(item.fixture.storage.sources.getLatestSetup(item.setup.studyId)).toEqual(item.setup)
    expect(item.fixture.storage.liveStudyGuard.sharedStatus(item.setup.id)).toEqual(budget)
    expect(bookFixtureTurns(item.fixture)).toHaveLength(0)
  },
)
it("refuses stale Revise/Cancel after Send without resetting already charged source spending", async () => {
  const item = await analysisPurposeFixture()
  fixtures.push(item)
  const runtime = item.runtime()
  runtime.pipeline.prepare(item.setup.id, item.grant.id)
  await runtime.worker.runNext()
  const budget = item.fixture.storage.liveStudyGuard.sharedStatus(item.setup.id),
    before = item.fixture.storage.counts()
  expect(budget?.used).toBe(1)
  const server = app(item)
  for (const decision of ["revise", "cancel"])
    expect(
      (
        await server.request(
          `${origin}/api/study-setup/${item.normalization.id}/${item.setup.id}`,
          { ...request, body: JSON.stringify({ decision }) },
        )
      ).status,
    ).toBe(409)
  const newDraft = await server.request(`${origin}/api/study-setup/${item.normalization.id}`, {
    ...request,
    body: JSON.stringify({
      provider: "chatgpt-subscription",
      model: "study-model",
      purpose: "analysis-evaluation-1",
    }),
  })
  expect(newDraft.status).toBe(409)
  expect(await newDraft.json()).toMatchObject({
    error: "analysis-purpose-requires-fresh-study",
    transmission: "not-sent",
  })
  expect(item.fixture.storage.sources.getGrant(item.grant.id)).toEqual(item.grant)
  expect(item.fixture.storage.sources.getLatestSetup(item.setup.studyId)).toEqual(item.setup)
  expect(item.fixture.storage.liveStudyGuard.sharedStatus(item.setup.id)).toEqual(budget)
  expect(item.fixture.storage.counts()).toEqual(before)
})
it("only selects the new purpose explicitly and shows an unbound draft without minting consent", async () => {
  const fixture = await sourceViewerFixture({ managedChatGPT: true })
  try {
    const headers = { origin: fixture.origin, "content-type": "application/json" }
    const draft = await fetch(`${fixture.origin}/api/study-setup/revision-fixture`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: "chatgpt-subscription",
        model: "study-model",
        purpose: "analysis-evaluation-1",
      }),
    })
    expect(draft.status).toBe(201)
    const created: unknown = await draft.json()
    const { z } = await import("zod")
    const { setupId } = z.object({ setupId: z.string() }).parse(created)
    const review = await fetch(`${fixture.origin}/api/study-setup/revision-fixture/${setupId}`)
    expect(await review.json()).toMatchObject({
      setup: {
        analysis: { purpose: { version: "analysis-evaluation-1", terminal: "verified-analysis" } },
      },
      preparation: {
        purposeTargetBound: false,
        batchedMaximum: { maxTotalAttempts: 18, reservedLaterAttempts: 0 },
      },
    })
    const send = await fetch(`${fixture.origin}/api/study-setup/revision-fixture/${setupId}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "send" }),
    })
    expect(send.status).toBe(409)
    expect(fixture.storage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
  } finally {
    await fixture.close()
  }
})
