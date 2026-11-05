import { randomUUID } from "node:crypto"
import {
  contentDigest,
  FullBookTestConsent,
  FullBookTestSession,
  NormalizationRevision,
  planFullBookTest,
  wholeBookScope,
} from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { fullBookConsentInput, fullBookServerFixture } from "./testing/full-book-run-fixture.ts"

it("exports only the closed run even while another book has active experimental work", async () => {
  // Given one closed run and a separate active source budget in the same single-owner library.
  const f = fullBookServerFixture()
  try {
    const input = await fullBookConsentInput(f)
    expect((await f.post("consent", input)).status).toBe(201)
    await f.post(`runs/${input.submissionId}/cancel`, {})
    const hash = contentDigest("other synthetic source"),
      normalization = NormalizationRevision.parse({
        ...f.budget.session.input.normalization,
        id: "other-normalization",
        editionId: "other-edition",
        editionHash: hash,
      })
    f.storage.sources.appendEdition({
      id: normalization.editionId,
      title: "Other synthetic book",
      originalHash: hash,
      originalBlobHash: hash,
    })
    f.storage.sources.appendNormalization({ record: normalization, parentRevisionId: null })
    const nextInput = {
      ...f.budget.session.input,
      normalization,
      windows: f.budget.session.input.windows.map((window) =>
        window.map((span) => ({
          ...span,
          editionId: normalization.editionId,
          normalizationRevisionId: normalization.id,
        })),
      ),
    }
    const session = FullBookTestSession.parse({
      ...f.budget.session,
      input: nextInput,
      plan: planFullBookTest(nextInput),
    })
    f.storage.sources.createStudy({
      id: "other-study",
      ownerId: f.budget.ownerId,
      editionId: normalization.editionId,
    })
    const setup = {
      ...f.setup,
      id: "other-setup",
      studyId: "other-study",
      editionId: normalization.editionId,
      analysis: {
        ...f.setup.analysis,
        editionHash: hash,
        normalizationRevisionId: normalization.id,
        scope: wholeBookScope(normalization),
      },
    }
    f.storage.sources.appendSetup({ record: setup, parentRevisionId: null })
    f.storage.fullBookConsent.approve(
      FullBookTestConsent.parse({
        ...f.budget,
        id: randomUUID(),
        studyId: setup.studyId,
        setupRevisionId: setup.id,
        session,
      }),
    )
    // When the closed run is downloaded, then unrelated active work neither leaks nor blocks its historical audit.
    const response = await f.app.request(
      `/api/full-book-test/${f.setup.id}/runs/${input.submissionId}/export`,
      { headers: { host: "localhost:8787" } },
    )
    expect(response.status, await response.clone().text()).toBe(200)
  } finally {
    f.cleanup()
  }
})
