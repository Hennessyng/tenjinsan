import { afterEach, expect, it } from "vitest"
import { sourceViewerFixture } from "./testing/source-viewer-fixture.ts"

const fixtures: Awaited<ReturnType<typeof sourceViewerFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("reviews whole extracted scope and refuses unverified original attachments without disabling text-only Send", async () => {
  // Given
  const fixture = await sourceViewerFixture({ providerAvailable: true })
  fixtures.push(fixture)
  const headers = { origin: fixture.origin, "content-type": "application/json" }
  // When
  const response = await fetch(`${fixture.origin}/api/study-setup/revision-fixture`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider: "anthropic" }),
  })
  // Then
  expect(response.status).toBe(201)
  const created = await response.json()
  const id =
    typeof created === "object" &&
    created &&
    "setupId" in created &&
    typeof created.setupId === "string"
      ? created.setupId
      : "missing"
  const review = await fetch(`${fixture.origin}/api/study-setup/revision-fixture/${id}`)
  expect(await review.json()).toMatchObject({
    attachment: { status: "unavailable", reason: "exact-format-support-unverified" },
  })
  const blocked = await fetch(`${fixture.origin}/api/study-setup/revision-fixture/${id}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "send", includeOriginal: true }),
  })
  expect(blocked.status).toBe(415)
  expect(fixture.storage.counts().grants).toBe(0)
  const sent = await fetch(`${fixture.origin}/api/study-setup/revision-fixture/${id}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "send" }),
  })
  expect(sent.status).toBe(200)
  expect(fixture.storage.sources.getGrant(`grant-${id}`)).toMatchObject({
    categories: ["book-text", "derived-study-material", "reader-context"],
  })
})
