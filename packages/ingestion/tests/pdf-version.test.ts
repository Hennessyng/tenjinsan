import { mkdtemp, open, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AnalysisCacheInput, analysisCacheKey, wholeBookScope } from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { prepareSourceDocument } from "../src/source-document.ts"
import { pdfFixture } from "./document-fixtures.ts"

async function prepare(normalizerVersion?: string, parserVersion?: string) {
  const directory = await mkdtemp(join(tmpdir(), "pdf-version-"))
  try {
    const path = join(directory, "source.pdf")
    await writeFile(path, pdfFixture(["Version identity"]))
    await using file = await open(path, "r")
    return await prepareSourceDocument(file, {
      title: "Synthetic version",
      format: "pdf",
      ...(normalizerVersion ? { normalizerVersion } : {}),
      ...(parserVersion ? { parserVersion } : {}),
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

it("changes default PDF normalization/cache identity while preserving original bytes and determinism", async () => {
  // Given: the explicit old tag exercises identity only, not the old extractor implementation.
  const oldTag = await prepare("pdf-normalizer-4", "pdf-parser-3")
  // When
  const [current, repeated] = await Promise.all([prepare(), prepare()])
  // Then
  expect(current.edition).toEqual(oldTag.edition)
  expect(current).toEqual(repeated)
  expect(current.normalization.parserVersion).toBe("pdf-parser-3")
  expect(current.normalization.normalizerVersion).toBe("pdf-normalizer-5")
  expect(current.normalization.id).not.toBe(oldTag.normalization.id)
  const currentScope = wholeBookScope(current.normalization)
  const oldScope = wholeBookScope(oldTag.normalization)
  if (!currentScope || !oldScope) throw new TypeError("Nonempty PDF must produce a scope")
  expect(currentScope.selected).not.toEqual(oldScope.selected)
  const identity = (normalization: typeof current.normalization) =>
    analysisCacheKey(
      AnalysisCacheInput.parse({
        editionHash: normalization.editionHash,
        normalizationRevisionId: normalization.id,
        scope: wholeBookScope(normalization),
        provider: "openrouter",
        model: "synthetic-cache-only",
        analysisPromptVersion: "whole-book-2",
        analysisSchemaVersion: "whole-book-2",
        settings: {
          temperature: 0,
          topP: 1,
          maxOutputTokens: 64,
          seed: null,
          reasoningEffort: "default",
        },
      }),
    )
  expect(identity(current.normalization)).not.toBe(identity(oldTag.normalization))
})
