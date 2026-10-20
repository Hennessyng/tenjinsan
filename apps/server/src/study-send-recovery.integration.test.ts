import { afterEach, expect, it } from "vitest"
import { sourceViewerFixture } from "./testing/source-viewer-fixture.ts"

const fixtures: Awaited<ReturnType<typeof sourceViewerFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("returns persisted consent on granted review and repeated Send without duplicating the grant", async () => {
  // Given
  const fixture = await sourceViewerFixture()
  fixtures.push(fixture)
  const headers = { origin: fixture.origin, "content-type": "application/json" }
  const draft = await fetch(`${fixture.origin}/api/study-setup/revision-fixture`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider: "anthropic" }),
  })
  const { setupId } = await draft.json()
  const url = `${fixture.origin}/api/study-setup/revision-fixture/${setupId}`
  const first = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "send" }),
  })
  const saved = await first.json()
  // When
  const reload = await fetch(url)
  const replay = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "send" }),
  })
  // Then
  expect(reload.status).toBe(200)
  expect(await reload.json()).toEqual(saved)
  expect(replay.status).toBe(200)
  expect(await replay.json()).toEqual(saved)
  expect(fixture.storage.counts()).toMatchObject({ grants: 1, jobs: 0, attempts: 0 })
})

it("reports saved consent when scheduling fails and resumes with the existing grant", async () => {
  // Given
  let scheduling = 0
  const fixture = await sourceViewerFixture({
    onSetupSend: () => {
      scheduling += 1
      if (scheduling === 1) throw new TypeError("Synthetic scheduling interruption")
    },
  })
  fixtures.push(fixture)
  const headers = { origin: fixture.origin, "content-type": "application/json" }
  const draft = await fetch(`${fixture.origin}/api/study-setup/revision-fixture`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider: "anthropic" }),
  })
  const { setupId } = await draft.json()
  const url = `${fixture.origin}/api/study-setup/revision-fixture/${setupId}`
  // When
  const first = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "send" }),
  })
  // Then
  expect(first.status).toBe(200)
  expect(await first.json()).toMatchObject({
    decision: "send",
    grantId: `grant-${setupId}`,
    analysisProgress: "not-scheduled",
  })
  const recovery = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "resume" }),
  })
  expect(recovery.status).toBe(200)
  expect(scheduling).toBe(2)
  expect(fixture.storage.counts().grants).toBe(1)
})

it("accepts concurrent duplicate Send as the same saved decision", async () => {
  // Given
  let scheduled = 0
  const fixture = await sourceViewerFixture({
    onSetupSend: () => {
      scheduled += 1
    },
  })
  fixtures.push(fixture)
  const headers = { origin: fixture.origin, "content-type": "application/json" }
  const draft = await fetch(`${fixture.origin}/api/study-setup/revision-fixture`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider: "anthropic" }),
  })
  const { setupId } = await draft.json()
  const url = `${fixture.origin}/api/study-setup/revision-fixture/${setupId}`
  // When
  const replies = await Promise.all(
    [1, 2].map(() =>
      fetch(url, { method: "POST", headers, body: JSON.stringify({ decision: "send" }) }),
    ),
  )
  // Then
  expect(replies.map((reply) => reply.status)).toEqual([200, 200])
  expect(await replies[0]?.json()).toEqual(await replies[1]?.json())
  expect(fixture.storage.counts().grants).toBe(1)
  expect(scheduled).toBe(1)
})
