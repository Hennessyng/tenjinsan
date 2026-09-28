import { changeEvidenceReview, openEvidenceReview } from "@reading-studio/generation/review"
import { evidenceFixture } from "@reading-studio/server/evidence-fixture"
import { afterEach, expect, test } from "vitest"

let fixture: Awaited<ReturnType<typeof evidenceFixture>> | undefined
afterEach(async () => fixture?.close())

test("publication panel rejects publishing an unresolved privacy review", async () => {
  // Given
  fixture = await evidenceFixture()
  const login = await fetch(`${fixture.origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: fixture.origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fixture.credentials),
  })
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
  const view = openEvidenceReview(fixture.storage, fixture.lesson.id)
  // When
  const response = await fetch(`${fixture.origin}/publications/${fixture.lesson.studyId}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie,
      origin: fixture.origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ action: "publish", expectedId: view.draft.id }),
  })
  // Then
  expect(response.status).toBe(409)
  expect(fixture.storage.counts().publications).toBe(0)
})

test("publication panel shows only cleaned content before explicit approval", async () => {
  // Given
  fixture = await evidenceFixture()
  const before = openEvidenceReview(fixture.storage, fixture.lesson.id)
  changeEvidenceReview(fixture.storage, fixture.lesson.id, {
    action: "replace-text",
    expectedId: before.draft.id,
    path: "/sections/0/content/en",
    text: "Ask a colleague what they heard.",
  })
  const login = await fetch(`${fixture.origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: fixture.origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fixture.credentials),
  })
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
  // When
  const response = await fetch(`${fixture.origin}/publications/${fixture.lesson.studyId}`, {
    headers: { cookie },
  })
  // Then
  expect(response.status).toBe(200)
  const body = await response.text()
  expect(body).toContain("Ask a colleague what they heard.")
  expect(body).not.toContain("Mira Canarystone")
  expect(fixture.storage.counts().publications).toBe(0)
})
