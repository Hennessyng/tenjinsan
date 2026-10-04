import { defaultSettings } from "@reading-studio/providers"
import { afterEach, beforeEach, expect, test } from "vitest"
import { sourceViewerFixture } from "./testing/source-viewer-fixture.ts"

let fixture: Awaited<ReturnType<typeof sourceViewerFixture>>
let cookie: string
beforeEach(async () => {
  fixture = await sourceViewerFixture({ providerAvailable: false })
  fixture.storage.sources.appendSetup({
    parentRevisionId: null,
    record: {
      id: "setup-ui",
      studyId: "study-fixture",
      editionId: "edition-fixture",
      analysis: {
        editionHash: "a".repeat(64),
        normalizationRevisionId: "revision-fixture",
        scope: {
          kind: "partial",
          selected: [
            { resourcePath: "chapter-one.xhtml", blockIds: ["opening", "passage", "unsafe"] },
          ],
          exclusions: [],
        },
        provider: "openai",
        model: "fixture",
        analysisPromptVersion: "analysis-1",
        analysisSchemaVersion: "analysis-1",
        settings: defaultSettings,
      },
      generation: {
        promptVersion: "generation-1",
        schemaVersion: "generation-1",
        settings: defaultSettings,
      },
    },
  })
  const response = await fetch(`${fixture.origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: fixture.origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fixture.credentials),
  })
  cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
})
afterEach(async () => fixture.close())

function submit(fields: Readonly<Record<string, string>>) {
  return fetch(`${fixture.origin}/revisions/study-fixture`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie,
      origin: fixture.origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields),
  })
}

test("creates a revision without consent when a native provider form is submitted", async () => {
  // Given / When
  const response = await submit({
    action: "provider",
    provider: "anthropic",
    expectedSetupRevisionId: "setup-ui",
  })
  // Then
  expect(response.status).toBe(303)
  expect(response.headers.get("location")).toBe("/revisions/study-fixture")
  expect(fixture.storage.sources.getLatestSetup("study-fixture")?.analysis.provider).toBe(
    "anthropic",
  )
  expect(fixture.storage.sources.getSetup("setup-ui")?.analysis.provider).toBe("openai")
  expect(fixture.storage.counts().grants).toBe(0)
})

test("rejects forged consent when the selected provider lacks a server credential", async () => {
  // Given / When
  const response = await submit({ action: "consent", expectedSetupRevisionId: "setup-ui" })
  // Then
  expect(response.status).toBe(503)
  expect(fixture.storage.counts().grants).toBe(0)
})

test("rejects stale native fork forms without creating another study", async () => {
  // Given / When
  const response = await submit({ action: "fork", expectedSetupRevisionId: "superseded-setup" })
  // Then
  expect(response.status).toBe(409)
  expect(fixture.storage.counts().studies).toBe(1)
})

test("requires a session, owned study and origin for revision forms", async () => {
  // Given / When
  const anonymous = await fetch(`${fixture.origin}/revisions/study-fixture`)
  const missing = await fetch(`${fixture.origin}/revisions/foreign-study`, { headers: { cookie } })
  const withoutOrigin = await fetch(`${fixture.origin}/revisions/study-fixture`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ action: "fork", expectedSetupRevisionId: "setup-ui" }),
  })
  // Then
  expect(anonymous.status).toBe(401)
  expect(missing.status).toBe(404)
  expect(withoutOrigin.status).toBe(403)
  expect(fixture.storage.counts().studies).toBe(1)
})
