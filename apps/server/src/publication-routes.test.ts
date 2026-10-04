import { changeEvidenceReview, openEvidenceReview } from "@reading-studio/generation/review"
import { publicationFixture } from "@reading-studio/server/publication-fixture"
import { openStorage } from "@reading-studio/storage"
import { afterEach, expect, test } from "vitest"
import { createApp } from "./app.ts"
import { approvePublication, renderPublicationOutput } from "./publication-service.ts"

let fixture: Awaited<ReturnType<typeof publicationFixture>> | undefined
afterEach(async () => fixture?.close())

async function login(current: Awaited<ReturnType<typeof publicationFixture>>) {
  const response = await fetch(`${current.origin}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: current.origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(current.credentials),
  })
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
}

test("versioned downloads require authentication and resource ownership", async () => {
  // Given
  fixture = await publicationFixture()
  const { storage, view } = fixture
  const snapshot = approvePublication(storage, view)
  const output = storage.publicationOutputs.outputs(snapshot.publication.id)[0]
  if (!output) throw new TypeError("Missing output")
  await renderPublicationOutput(storage, output)
  const cookie = await login(fixture)
  const url = `${fixture.origin}/publication-artifacts/${output.id}`
  const foreignApp = createApp({
    reviewStorage: storage,
    auth: {
      ownerId: async () => "other-owner",
      handler: async () => new Response(null, { status: 401 }),
    },
    security: {
      trustedOrigins: [fixture.origin],
      trustProxy: false,
      apiBodyBytes: 1024,
      loginBodyBytes: 1024,
      uploadBodyBytes: 1024,
      loginRateLimit: { attempts: 10, windowMs: 1000 },
      logger: () => undefined,
    },
  })
  // When
  const anonymous = await fetch(url)
  const foreign = await foreignApp.request(url)
  const owner = await fetch(url, { headers: { cookie } })
  // Then
  expect(anonymous.status).toBe(401)
  expect(foreign.status).toBe(404)
  expect(owner.status).toBe(200)
  expect(owner.headers.get("content-disposition")).toContain(
    `publication-${snapshot.publication.id}.html`,
  )
  expect(owner.headers.get("cache-control")).toBe("private, no-store")
  expect(owner.headers.get("x-publication-state")).toBe("current")
  const reopened = openStorage({
    databasePath: fixture.databasePath,
    privateDataRoot: fixture.privateDataRoot,
  })
  try {
    expect(reopened.publicationOutputs.download(output.id)).toEqual(
      storage.publicationOutputs.download(output.id),
    )
    expect(reopened.publicationOutputs.get(snapshot.publication.id)).toEqual(snapshot)
  } finally {
    reopened.close()
  }
})

test("newer lessons fence both queued outputs and reject a malicious reused lesson approval", async () => {
  // Given
  fixture = await publicationFixture()
  const { storage, view, lesson } = fixture
  const snapshot = approvePublication(storage, view)
  storage.workflow.appendLesson({
    parentRevisionId: lesson.id,
    record: { ...lesson, id: "newer-lesson" },
  })
  // When
  const current = storage.publicationOutputs.current(snapshot)
  // Then
  expect(current).toBe(false)
  expect(() => approvePublication(storage, view)).toThrow()
  for (const output of storage.publicationOutputs.outputs(snapshot.publication.id))
    expect(() => storage.publicationOutputs.claim(output.id)).toThrow()
})

test("failed exports stay errors and old successful files remain labelled stale", async () => {
  // Given
  fixture = await publicationFixture()
  const { storage, view, lesson } = fixture
  const first = approvePublication(storage, view)
  const oldOutput = storage.publicationOutputs.outputs(first.publication.id)[0]
  if (!oldOutput) throw new TypeError("Missing output")
  await renderPublicationOutput(storage, oldOutput)
  const oldBytes = storage.publicationOutputs.download(oldOutput.id)
  let changed = changeEvidenceReview(storage, lesson.id, {
    action: "correct",
    expectedId: view.draft.id,
    projection: {
      ...view.draft.projection,
      assets: [
        {
          id: "missing-asset",
          contentHash: "c".repeat(64),
          mediaType: "image/png",
          alt: { en: "Missing image", ja: "欠落した画像" },
          license: "CC0",
        },
      ],
    },
  })
  for (const category of ["support", "qualification", "translation", "visual"] as const)
    changed = changeEvidenceReview(storage, lesson.id, {
      action: "semantic",
      expectedId: changed.draft.id,
      category,
      status: "reviewed",
    })
  changed = changeEvidenceReview(storage, lesson.id, {
    action: "privacy-reviewed",
    expectedId: changed.draft.id,
  })
  const second = approvePublication(storage, changed)
  // When
  for (const output of storage.publicationOutputs.outputs(second.publication.id))
    await renderPublicationOutput(storage, output)
  // Then
  for (const output of storage.publicationOutputs.outputs(second.publication.id)) {
    expect(output).toMatchObject({ state: "failed", error: "render-error", artifact: null })
    expect(storage.publicationOutputs.download(output.id)).toBeNull()
  }
  expect(storage.publicationOutputs.download(oldOutput.id)).toEqual(oldBytes)
  const cookie = await login(fixture)
  const oldResponse = await fetch(`${fixture.origin}/publication-artifacts/${oldOutput.id}`, {
    headers: { cookie },
  })
  expect(oldResponse.status).toBe(200)
  expect(oldResponse.headers.get("x-publication-state")).toBe("stale")
  const panel = await fetch(`${fixture.origin}${fixture.path}`, { headers: { cookie } })
  expect(await panel.text()).toContain("Error / エラー: render-error")
}, 90_000)

test("publication rejects forged content and renderer fields instead of trusting request approvals", async () => {
  // Given
  fixture = await publicationFixture()
  const cookie = await login(fixture)
  const view = openEvidenceReview(fixture.storage, fixture.lesson.id)
  // When
  const response = await fetch(`${fixture.origin}${fixture.path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie,
      origin: fixture.origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      action: "publish",
      expectedId: view.draft.id,
      rendererVersion: "forged",
      projectionHash: "a".repeat(64),
    }),
  })
  // Then
  expect(response.status).toBe(422)
  expect(fixture.storage.counts().publications).toBe(0)
})

test("changed source setup invalidates publication approval before either output starts", async () => {
  // Given
  fixture = await publicationFixture()
  const { storage, view, lesson } = fixture
  const snapshot = approvePublication(storage, view)
  const setup = storage.sources.getSetup(lesson.setupRevisionId)
  if (!setup) throw new TypeError("Missing setup")
  // When
  storage.sources.appendSetup({
    parentRevisionId: setup.id,
    record: { ...setup, id: "changed-setup" },
  })
  // Then
  expect(storage.publicationOutputs.current(snapshot)).toBe(false)
  for (const output of storage.publicationOutputs.outputs(snapshot.publication.id))
    expect(() => storage.publicationOutputs.claim(output.id)).toThrow()
})
