import { afterEach, expect, it } from "vitest"
import { sourceViewerFixture } from "./testing/source-viewer-fixture.ts"

const fixtures: Awaited<ReturnType<typeof sourceViewerFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})
async function session(available = true) {
  const fixture = await sourceViewerFixture({ providerAvailable: available })
  fixtures.push(fixture)
  const login = await fetch(`${fixture.origin}/login`, {
    method: "POST",
    headers: { origin: fixture.origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fixture.credentials),
    redirect: "manual",
  })
  const cookie = login.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")
  return {
    ...fixture,
    headers: {
      cookie,
      origin: fixture.origin,
      "content-type": "application/x-www-form-urlencoded",
    },
  }
}
it("providers setup persists a draft without granting or enqueuing any cloud work", async () => {
  // Given
  const fixture = await session()
  // When
  const response = await fetch(`${fixture.origin}/sources/revision-fixture/setup`, {
    method: "POST",
    headers: fixture.headers,
    body: new URLSearchParams({
      provider: "openai",
      scope: "partial",
      chapters: "chapter-one.xhtml",
    }),
    redirect: "manual",
  })
  // Then
  expect(response.status).toBe(303)
  expect(fixture.storage.counts()).toMatchObject({
    setups: 1,
    grants: 0,
    runs: 0,
    jobs: 0,
    attempts: 0,
  })
  const location = response.headers.get("location")
  expect(location).toBeTruthy()
  const setupId = location?.split("/").at(-1)
  const setup = fixture.storage.sources.getSetup(setupId)
  expect(setup?.analysis.scope.selected.map((resource) => resource.resourcePath)).toEqual([
    "chapter-one.xhtml",
  ])
  expect(setup?.analysis.scope.exclusions.map((resource) => resource.resourcePath)).toEqual([
    "chapter-two.xhtml",
  ])
})
it("providers setup rejects Send with missing credentials without persisting an active grant", async () => {
  // Given
  const fixture = await session(false)
  const draft = await fetch(`${fixture.origin}/sources/revision-fixture/setup`, {
    method: "POST",
    headers: fixture.headers,
    body: new URLSearchParams({ provider: "anthropic", scope: "all-main-chapters" }),
    redirect: "manual",
  })
  // When
  const response = await fetch(`${fixture.origin}${draft.headers.get("location")}`, {
    method: "POST",
    headers: fixture.headers,
    body: new URLSearchParams({ decision: "send" }),
  })
  // Then
  expect(response.status).toBe(503)
  expect(fixture.storage.counts()).toMatchObject({ setups: 1, grants: 0, jobs: 0, attempts: 0 })
})
it("providers setup binds Send to the stored draft and consumes the decision once", async () => {
  // Given
  const fixture = await session()
  const draft = await fetch(`${fixture.origin}/sources/revision-fixture/setup`, {
    method: "POST",
    headers: fixture.headers,
    body: new URLSearchParams({
      provider: "anthropic",
      scope: "partial",
      chapters: "chapter-two.xhtml",
    }),
    redirect: "manual",
  })
  const location = draft.headers.get("location")
  // When
  const response = await fetch(`${fixture.origin}${location}`, {
    method: "POST",
    headers: fixture.headers,
    body: new URLSearchParams({ decision: "send" }),
  })
  // Then
  expect(response.status).toBe(200)
  const id = location?.split("/").at(-1)
  const grant = fixture.storage.sources.getGrant(`grant-${id}`)
  expect(grant).toMatchObject({
    kind: "active",
    setupRevisionId: id,
    categories: ["book-text", "derived-study-material", "reader-context"],
  })
  expect(fixture.storage.counts()).toMatchObject({ grants: 1, jobs: 0, attempts: 0 })
  const replay = await fetch(`${fixture.origin}${location}`, {
    method: "POST",
    headers: fixture.headers,
    body: new URLSearchParams({ decision: "send" }),
  })
  expect(replay.status).toBe(409)
})
it.each([
  { provider: "unlisted", scope: "all-main-chapters" },
  { provider: "openai", scope: "partial", chapters: "appendix.xhtml" },
  { provider: "openai", scope: "partial" },
  { provider: "openai", scope: "all-main-chapters", model: "arbitrary-model" },
])("providers setup rejects invalid choices %j without a persisted setup", async (choices) => {
  // Given
  const fixture = await session()
  // When
  const response = await fetch(`${fixture.origin}/sources/revision-fixture/setup`, {
    method: "POST",
    headers: fixture.headers,
    body: new URLSearchParams(choices),
  })
  // Then
  expect(response.status).toBe(400)
  expect(fixture.storage.counts().setups).toBe(0)
})
