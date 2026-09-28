import { createHash } from "node:crypto"
import {
  Artifact,
  PUBLICATION_RENDERER,
  publicationTeachingStateIds,
} from "@reading-studio/contracts"
import { changeEvidenceReview } from "@reading-studio/generation/review"
import { publicationFixture } from "@reading-studio/server/publication-fixture"
import { ContractBoundaryError } from "@reading-studio/storage"
import { afterEach, expect, test, vi } from "vitest"
import { approvePublication, renderPublicationOutput } from "./publication-service.ts"

let fixture: Awaited<ReturnType<typeof publicationFixture>> | undefined
afterEach(async () => {
  vi.useRealTimers()
  await fixture?.close()
})

test("approval pins authoritative reports and derived manifests when Publish is chosen", async () => {
  // Given
  fixture = await publicationFixture()
  // When
  const snapshot = approvePublication(fixture.storage, fixture.view)
  // Then
  expect(snapshot.publication.approval).toMatchObject({
    projectionHash: fixture.view.draft.projectionHash,
    evidenceReportHash: fixture.view.reportHash,
    privacyReviewId: fixture.view.privacy.id,
    rendererVersion: PUBLICATION_RENDERER,
    requiredStateIds: publicationTeachingStateIds(fixture.view.draft.projection),
    assetHashes: [],
  })
  expect(
    fixture.storage.publicationOutputs
      .outputs(snapshot.publication.id)
      .map((job) => [job.format, job.state]),
  ).toEqual([
    ["html", "queued"],
    ["pdf", "queued"],
  ])
  expect(approvePublication(fixture.storage, fixture.view).publication.id).toBe(
    snapshot.publication.id,
  )
})

for (const path of [
  "/sections/0/scenes/0/captions/0/text/en",
  "/sections/0/practice/0/options/0/feedback/en",
  "/sections/0/sourceNotes/0/note/en",
])
  test(`both jobs reject a changed ${path} with the same lesson ID`, async () => {
    // Given
    fixture = await publicationFixture()
    const snapshot = approvePublication(fixture.storage, fixture.view)
    const { storage, view } = fixture
    // When
    changeEvidenceReview(fixture.storage, fixture.lesson.id, {
      action: "replace-text",
      expectedId: fixture.view.draft.id,
      path,
      text: "A different explanation.",
    })
    // Then
    expect(fixture.storage.publicationOutputs.current(snapshot)).toBe(false)
    for (const output of fixture.storage.publicationOutputs.outputs(snapshot.publication.id))
      expect(() => fixture?.storage.publicationOutputs.claim(output.id)).toThrow(
        /current publication/,
      )
    expect(() => approvePublication(storage, view)).toThrow()
  })

test("asset edits invalidate approval even when the lesson ID is reused", async () => {
  // Given
  fixture = await publicationFixture()
  const snapshot = approvePublication(fixture.storage, fixture.view)
  // When
  changeEvidenceReview(fixture.storage, fixture.lesson.id, {
    action: "correct",
    expectedId: fixture.view.draft.id,
    projection: {
      ...fixture.view.draft.projection,
      assets: [
        {
          id: "new-asset",
          contentHash: "c".repeat(64),
          mediaType: "image/png",
          alt: { en: "Illustration", ja: "図" },
          license: "CC0",
        },
      ],
    },
  })
  // Then
  expect(fixture.storage.publicationOutputs.current(snapshot)).toBe(false)
})

test("release rejects an edit during rendering and cannot expose partial bytes", async () => {
  // Given
  fixture = await publicationFixture()
  const { storage, view, lesson } = fixture
  const snapshot = approvePublication(storage, view)
  const output = storage.publicationOutputs.outputs(snapshot.publication.id)[0]
  if (!output) throw new TypeError("Missing output")
  storage.publicationOutputs.claim(output.id)
  const bytes = Buffer.from("unreleased data")
  const artifact = Artifact.parse({
    id: "release-fixture",
    publicationRevisionId: snapshot.publication.id,
    projectionHash: view.draft.projectionHash,
    format: output.format,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    embeddedAssetHashes: [],
    teachingStateIds: snapshot.publication.approval.requiredStateIds,
    validation: { status: "passed", reportHash: view.reportHash },
    provenance: {
      jobId: output.id,
      rendererVersion: PUBLICATION_RENDERER,
      createdAt: new Date().toISOString(),
    },
  })
  // When
  changeEvidenceReview(storage, lesson.id, { action: "keep-private", expectedId: view.draft.id })
  // Then
  expect(() => storage.publicationOutputs.release(artifact, bytes)).toThrow(/current publication/)
  expect(storage.publicationOutputs.download(output.id)).toBeNull()
})

test("expired local output jobs become honest errors instead of permanent running states", async () => {
  // Given
  fixture = await publicationFixture()
  const snapshot = approvePublication(fixture.storage, fixture.view)
  const output = fixture.storage.publicationOutputs.outputs(snapshot.publication.id)[0]
  if (!output) throw new TypeError("Missing output")
  fixture.storage.publicationOutputs.claim(output.id)
  vi.useFakeTimers()
  // When
  vi.setSystemTime(Date.now() + 121_000)
  // Then
  expect(fixture.storage.publicationOutputs.output(output.id)).toMatchObject({
    state: "failed",
    error: "interrupted-or-timeout",
  })
  expect(fixture.storage.publicationOutputs.download(output.id)).toBeNull()
})

test("renderer mismatch cannot approve or release even with the same content hash", async () => {
  // Given
  fixture = await publicationFixture()
  const { storage, view } = fixture
  const snapshot = approvePublication(storage, view)
  const output = storage.publicationOutputs.outputs(snapshot.publication.id)[0]
  if (!output) throw new TypeError("Missing output")
  storage.publicationOutputs.claim(output.id)
  const bytes = Buffer.from("wrong renderer")
  // When
  const forged = {
    ...snapshot,
    publication: {
      ...snapshot.publication,
      approval: { ...snapshot.publication.approval, rendererVersion: "other-renderer" },
    },
  }
  // Then
  expect(storage.publicationOutputs.current(forged)).toBe(false)
  expect(() =>
    storage.publicationOutputs.release(
      {
        id: "wrong-renderer",
        publicationRevisionId: snapshot.publication.id,
        projectionHash: view.draft.projectionHash,
        format: output.format,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        embeddedAssetHashes: [],
        teachingStateIds: snapshot.publication.approval.requiredStateIds,
        validation: { status: "passed", reportHash: view.reportHash },
        provenance: {
          jobId: output.id,
          rendererVersion: "other-renderer",
          createdAt: new Date().toISOString(),
        },
      },
      bytes,
    ),
  ).toThrow()
  expect(storage.publicationOutputs.download(output.id)).toBeNull()
})

test("privacy report edits invalidate an approval without changing the projection", async () => {
  // Given
  fixture = await publicationFixture()
  const { storage, view, lesson } = fixture
  const snapshot = approvePublication(storage, view)
  // When
  const changed = changeEvidenceReview(storage, lesson.id, {
    action: "privacy-flag",
    expectedId: view.draft.id,
    path: "/sections/0/content/en",
  })
  // Then
  expect(changed.draft.projectionHash).toBe(view.draft.projectionHash)
  expect(changed.privacy.status).toBe("blocked")
  expect(storage.publicationOutputs.current(snapshot)).toBe(false)
  expect(() => approvePublication(storage, changed)).toThrow()
})

test("a competing claimant cannot mark another renderer's running output failed", async () => {
  // Given: another process wins the claim between the initial read and this claim.
  fixture = await publicationFixture()
  const { storage, view } = fixture
  const snapshot = approvePublication(storage, view)
  const output = storage.publicationOutputs.outputs(snapshot.publication.id)[0]
  if (!output) throw new TypeError("Missing output")
  const claim = storage.publicationOutputs.claim.bind(storage.publicationOutputs)
  const competingClaim = vi
    .spyOn(storage.publicationOutputs, "claim")
    .mockImplementationOnce((input) => {
      claim(input)
      throw new ContractBoundaryError("already claimed by another renderer")
    })
  // When
  await renderPublicationOutput(storage, output)
  competingClaim.mockRestore()
  // Then
  expect(storage.publicationOutputs.output(output.id)?.state).toBe("running")
})

test("both actual renderers release valid files and preserve old successful bytes after edits", async () => {
  // Given
  fixture = await publicationFixture()
  const { storage, view, lesson } = fixture
  const snapshot = approvePublication(storage, view)
  // When
  for (const output of storage.publicationOutputs.outputs(snapshot.publication.id))
    await renderPublicationOutput(storage, output)
  // Then
  const outputs = storage.publicationOutputs.outputs(snapshot.publication.id)
  expect(outputs.map((output) => [output.format, output.state, output.error])).toEqual([
    ["html", "released", null],
    ["pdf", "released", null],
  ])
  for (const output of outputs) {
    const bytes = storage.publicationOutputs.download(output.id)
    expect(bytes).not.toBeNull()
    const text = Buffer.from(bytes ?? []).toString()
    expect(text).not.toContain("Mira Canarystone")
    expect(text).toContain(output.format === "pdf" ? "%PDF-" : "Ask a colleague")
  }
  changeEvidenceReview(storage, lesson.id, { action: "keep-private", expectedId: view.draft.id })
  expect(storage.publicationOutputs.current(snapshot)).toBe(false)
  for (const output of outputs)
    expect(storage.publicationOutputs.download(output.id)?.length).toBeGreaterThan(100)
}, 90_000)
