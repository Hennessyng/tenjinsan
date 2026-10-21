import { StudySetupRevision } from "@reading-studio/contracts"
import { NormalizationRevision } from "@reading-studio/contracts/source"
import { expect, it } from "vitest"
import { setupChoices, setupResult, setupReview } from "./page.ts"

it("discloses within-resource extraction omissions on native review without an acknowledgement", async () => {
  const normalization = NormalizationRevision.parse({
    id: "revision-1",
    editionId: "edition-1",
    editionHash: "a".repeat(64),
    parserVersion: "2",
    normalizerVersion: "2",
    coverage: "partial",
    omissions: [{ path: "source.txt", reason: "Unsupported illustration" }],
    resources: [
      {
        path: "source.txt",
        role: "main-chapter",
        status: "included",
        blocks: [{ id: "block-1", text: "Extracted text" }],
      },
    ],
  })
  const settings = {
    temperature: 0,
    topP: 1,
    maxOutputTokens: 6000,
    seed: null,
    reasoningEffort: "default",
  }
  const setup = StudySetupRevision.parse({
    id: "setup-1",
    studyId: "study-1",
    editionId: "edition-1",
    analysis: {
      editionHash: normalization.editionHash,
      normalizationRevisionId: normalization.id,
      scope: {
        kind: "whole-document",
        selected: [{ resourcePath: "source.txt", blockIds: ["block-1"] }],
        exclusions: [],
      },
      provider: "anthropic",
      model: "synthetic",
      analysisPromptVersion: "analysis-1",
      analysisSchemaVersion: "analysis-1",
      settings,
    },
    generation: { promptVersion: "generation-1", schemaVersion: "generation-1", settings },
  })
  const result = String(await setupReview({ setup, normalization, available: true }))
  expect(result).toContain("Extraction coverage: partial")
  expect(result).toContain("Unsupported illustration")
  expect(result).not.toContain('type="checkbox"')
  expect(result).toContain('name="decision" value="send"')
})

it("renders Japanese server setup choices without changing source paths or provider IDs", async () => {
  // Given
  const normalization = NormalizationRevision.parse({
    id: "revision-1",
    editionId: "edition-1",
    editionHash: "a".repeat(64),
    parserVersion: "2",
    normalizerVersion: "2",
    coverage: "complete",
    resources: [
      {
        path: "source.txt",
        role: "main-chapter",
        status: "included",
        blocks: [{ id: "block-1", text: "Original text" }],
      },
    ],
  })
  // When
  const result = String(
    await setupChoices({
      normalization,
      choices: [{ provider: "anthropic", model: "synthetic", label: "Anthropic synthetic" }],
      locale: "ja",
    }),
  )
  // Then
  expect(result).toContain("<h1>読書を設定する</h1>")
  expect(result).toContain('value="anthropic"')
  expect(result).toContain("source.txt")
  expect(result).not.toContain("Review transmission")
})

it("renders server setup choices without any scope, main-chapter or chapter controls", async () => {
  // Given: main, supplementary and omitted parts
  const normalization = NormalizationRevision.parse({
    id: "revision-1",
    editionId: "edition-1",
    editionHash: "a".repeat(64),
    parserVersion: "2",
    normalizerVersion: "2",
    coverage: "partial",
    resources: [
      {
        path: "chapter.xhtml",
        role: "main-chapter",
        status: "included",
        blocks: [{ id: "block-1", text: "Original text" }],
      },
      {
        path: "notes.xhtml",
        role: "supplementary",
        status: "included",
        blocks: [{ id: "block-2", text: "Supplementary text" }],
      },
      { path: "plate.xhtml", role: "supplementary", status: "excluded", reason: "unsupported" },
    ],
  })
  // When
  const result = String(
    await setupChoices({
      normalization,
      choices: [{ provider: "anthropic", model: "synthetic", label: "Anthropic synthetic" }],
    }),
  )
  // Then
  expect(result).not.toMatch(/name="scope"|name="chapters"|type="radio"|type="checkbox"/)
  expect(result).not.toMatch(/Choose specific chapters|All main chapters|Source scope/)
  expect(result).toContain("chapter.xhtml")
  expect(result).toContain("notes.xhtml")
  expect(result).toContain("Unavailable: plate.xhtml (unsupported)")
  expect(result).toContain("could not be extracted")
})

it("does not offer to create a study from an empty extraction", async () => {
  // Given
  const normalization = NormalizationRevision.parse({
    id: "revision-1",
    editionId: "edition-1",
    editionHash: "a".repeat(64),
    parserVersion: "2",
    normalizerVersion: "2",
    coverage: "partial",
    resources: [
      { path: "scan.xhtml", role: "main-chapter", status: "excluded", reason: "textless" },
    ],
  })
  // When
  const result = String(
    await setupChoices({
      normalization,
      choices: [{ provider: "anthropic", model: "synthetic", label: "Anthropic synthetic" }],
    }),
  )
  // Then
  expect(result).toContain("No text could be extracted")
  expect(result).toMatch(/<button[^>]*type="submit"[^>]*disabled/)
})

it("localizes result recovery and consent notice", async () => {
  // Given / When
  const result = String(
    await setupResult({
      title: "保存済み",
      message: "確認済み",
      revision: "revision-1",
      grantId: "grant-1",
      locale: "ja",
    }),
  )
  // Then
  expect(result).toContain("この設定そのものに対する許可を保存しました。")
  expect(result).toContain("設定に戻る")
  expect(result).not.toContain("Return to setup")
})
