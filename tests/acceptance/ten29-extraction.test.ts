import { createHash } from "node:crypto"
import {
  type NormalizationRevision,
  StudySetupRevision,
  wholeBookScope,
} from "@reading-studio/contracts"
import { prepareBookMapScope } from "@reading-studio/generation"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { PDFDocument } from "pdf-lib"
import { expect, it } from "vitest"
import { z } from "zod"
import { docxEntries, pdfFixture } from "../../packages/ingestion/tests/document-fixtures.ts"
import { epubEntries, zipFixture } from "../../packages/ingestion/tests/fixtures.ts"
import { auditRanges, type Range } from "./ten29/audit.ts"
import { corpus, extract, formats, render } from "./ten29/corpus-support.ts"
import { verifyFrozenCorpus } from "./ten29/freeze-proof.ts"
import inventoryData from "./ten29/inventory.json"

const inventories = z.record(z.string(), z.array(z.string()).length(4)).parse(inventoryData)
const cases = corpus.flatMap((family) => formats.map((format) => ({ family, format })))
const compact = (text: string) => text.replace(/\s+/gu, " ").trim()
function textParts(normalization: NormalizationRevision, format: string) {
  const blocks = normalization.resources.flatMap((r) => (r.status === "included" ? r.blocks : []))
  return format === "txt"
    ? blocks
        .map((b) => b.text)
        .join("")
        .split("\n")
    : blocks.map((b) => (format === "pdf" ? compact(b.text) : b.text))
}
function setupFor(normalization: NormalizationRevision) {
  const { setup } = completeGraphFixtures("openrouter")
  return StudySetupRevision.parse({
    ...setup,
    editionId: normalization.editionId,
    analysis: {
      ...setup.analysis,
      editionHash: normalization.editionHash,
      normalizationRevisionId: normalization.id,
      analysisPromptVersion: "whole-book-2",
      analysisSchemaVersion: "whole-book-2",
      scope: wholeBookScope(normalization),
    },
  })
}

it("retains the frozen originals, inventory, answers and policy before scored runs", async () => {
  await verifyFrozenCorpus()
})

it.each(cases)(
  "extracts $family.id/$format against a pre-existing inventory before planning",
  async ({ family, format }) => {
    // Given
    const expected = inventories[family.id]
    if (!expected) throw new TypeError("Missing independent inventory")
    const bytes = await render(family, format)
    // When
    const { normalization, edition } = await extract(bytes, format)
    // Then
    expect(edition.originalHash).toBe(createHash("sha256").update(bytes).digest("hex"))
    expect(textParts(normalization, format)).toEqual(
      format === "pdf" ? expected.map(compact) : expected,
    )
    expect(normalization.coverage).toBe("complete")
    expect(normalization.omissions).toEqual([])
    expect(normalization.resources.map((r) => r.path)).toEqual(
      format === "epub"
        ? ["book/1.xhtml", "book/2.xhtml", "book/3.xhtml", "book/4.xhtml"]
        : format === "docx"
          ? ["word/document.xml", "word/footnotes.xml"]
          : format === "pdf"
            ? ["pdf/page-1", "pdf/page-2", "pdf/page-3", "pdf/page-4"]
            : ["document.txt"],
    )
    if (format === "epub" || format === "docx")
      expect(normalization.resources.at(-1)?.role).toBe("supplementary")
  },
  30000,
)

it.each(cases)(
  "plans every included UTF-16 range exactly once for $family.id/$format",
  async ({ family, format }) => {
    // Given: independently checked extraction, not a semantic or dispatch verdict.
    const { normalization } = await extract(await render(family, format), format)
    expect(textParts(normalization, format)).toEqual(
      format === "pdf" ? inventories[family.id]?.map(compact) : inventories[family.id],
    )
    const expected: Range[] = normalization.resources.flatMap((resource) =>
      resource.status === "included"
        ? resource.blocks
            .filter((b) => b.text.length > 0)
            .map((block) => ({
              resourcePath: resource.path,
              blockId: block.id,
              start: 0,
              end: block.text.length,
              text: block.text,
            }))
        : [],
    )
    // When
    const plan = prepareBookMapScope(setupFor(normalization), normalization)
    // Then
    expect(plan.kind).toBe("ready")
    if (plan.kind !== "ready") throw new TypeError("Expected available text plan")
    const ranges = plan.windows.flatMap((w) => w.ranges ?? [w])
    expect(auditRanges(expected, ranges)).toEqual([])
    expect(Buffer.concat(ranges.map((r) => Buffer.from(r.text)))).toEqual(
      Buffer.concat(expected.map((r) => Buffer.from(r.text))),
    )
  },
  30000,
)

it.each(["middle", "late", "supplement"])(
  "detects missing %s original EPUB material before range construction",
  async (missing) => {
    // Given: corrupt the actual archive; keep the independent inventory unchanged.
    const family = corpus[0]
    if (!family) throw new TypeError("Missing family")
    const corrupted = { ...family, parts: family.parts.filter((p) => p.id !== missing) }
    // When
    const { normalization } = await extract(await render(corrupted, "epub"), "epub")
    // Then
    expect(textParts(normalization, "epub")).not.toEqual(inventories[family.id])
    // A valid reduced archive alone cannot know the absent original part.
    expect(normalization.coverage).toBe("complete")
  },
)

it.each(["txt", "epub", "docx"] as const)(
  "detects reordered and changed original text in %s before planning",
  async (format) => {
    // Given
    const family = corpus[0]
    if (!family) throw new TypeError("Missing family")
    const [opening, middle, late, supplement] = family.parts
    if (!opening || !middle || !late || !supplement) throw new TypeError("Missing parts")
    const variants = [
      { ...family, parts: [opening, late, middle, supplement] },
      {
        ...family,
        parts: [opening, { ...middle, text: middle.text.slice(0, -30) }, late, supplement],
      },
    ]
    // When / Then
    for (const corrupted of variants) {
      const { normalization } = await extract(await render(corrupted, format), format)
      expect(textParts(normalization, format)).not.toEqual(inventories[family.id])
    }
  },
)

it("records unsupported EPUB object content instead of treating it as original completeness", async () => {
  // Given
  const bytes = zipFixture(
    epubEntries.map((e) =>
      e.name === "book/chapter.xhtml"
        ? {
            ...e,
            text: e.text.replace("</body>", "<object>Material unavailable diagram</object></body>"),
          }
        : e,
    ),
  )
  // When
  const { normalization } = await extract(bytes, "epub")
  // Then
  expect(normalization.coverage).toBe("partial")
  expect(normalization.omissions).toContainEqual({
    path: "book/chapter.xhtml",
    reason: "removed:object",
  })
})

it("records the unsupported DOCX part and preserves supported supplementary text", async () => {
  // Given / When
  const { normalization } = await extract(zipFixture(docxEntries), "docx")
  // Then
  expect(normalization.coverage).toBe("partial")
  expect(normalization.omissions).toContainEqual({
    path: "word/unsupported.xml",
    reason: "unsupported-part",
  })
  expect(textParts(normalization, "docx")).toEqual([
    "Early heading",
    "Middle list",
    "Final cell",
    "Header text",
  ])
})

it("retains the PDF's missing-middle page identity without claiming full-original coverage", async () => {
  // Given
  const family = corpus[0]
  if (!family) throw new TypeError("Missing family")
  const pdf = await PDFDocument.load(await render(family, "pdf"))
  pdf.removePage(1)
  pdf.insertPage(1)
  // When
  const { normalization } = await extract(await pdf.save(), "pdf")
  // Then
  expect(normalization.coverage).toBe("partial")
  expect(normalization.resources[1]).toMatchObject({
    path: "pdf/page-2",
    status: "excluded",
    reason: "no-selectable-text",
  })
  expect(textParts(normalization, "pdf")).not.toEqual(inventories[family.id])
}, 30000)

it.each(formats)("blocks empty %s before range construction", async (format) => {
  // Given
  const blank = { id: "blank", parts: [{ id: "opening", text: " " }] }
  const bytes = format === "pdf" ? pdfFixture([""]) : await render(blank, format)
  // When / Then
  await expect(extract(bytes, format)).rejects.toMatchObject({ code: "empty-text" })
})
