import { StudySetupRevision, wholeBookScope } from "@reading-studio/contracts"
import { prepareBookMapScope } from "@reading-studio/generation"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { auditRanges, type Range } from "./ten29/audit.ts"
import { extract } from "./ten29/corpus-support.ts"

it.each(["none", "dropped", "reordered", "truncated", "duplicate", "identity"] as const)(
  "audits %s corruption of real extracted and planned Unicode ranges",
  async (fault) => {
    // Given
    const text = `${"日".repeat(3999)}🧭${"é".repeat(4000)}\nLate exception.`
    const { normalization } = await extract(Buffer.from(text), "txt")
    const original = completeGraphFixtures("openrouter").setup
    const setup = StudySetupRevision.parse({
      ...original,
      editionId: normalization.editionId,
      analysis: {
        ...original.analysis,
        editionHash: normalization.editionHash,
        normalizationRevisionId: normalization.id,
        scope: wholeBookScope(normalization),
        analysisPromptVersion: "whole-book-2",
        analysisSchemaVersion: "whole-book-2",
      },
    })
    const expected: Range[] = normalization.resources.flatMap((r) =>
      r.status === "included"
        ? r.blocks.map((b) => ({
            resourcePath: r.path,
            blockId: b.id,
            start: 0,
            end: b.text.length,
            text: b.text,
          }))
        : [],
    )
    const plan = prepareBookMapScope(setup, normalization)
    if (plan.kind !== "ready") throw new TypeError("Missing source plan")
    const ranges = plan.windows.flatMap((w) => w.ranges ?? [w])
    const [first, second, ...rest] = ranges
    if (!first || !second) throw new TypeError("Unicode case must cross a range boundary")
    const variants = {
      none: ranges,
      dropped: [first, ...rest],
      reordered: [second, first, ...rest],
      truncated: [
        first,
        { ...second, end: second.end - 1, text: second.text.slice(0, -1) },
        ...rest,
      ],
      duplicate: [first, first, second, ...rest],
      identity: [{ ...first, blockId: "foreign" }, second, ...rest],
    }
    // When
    const issues = auditRanges(expected, variants[fault])
    // Then
    const expectedIssues = {
      none: [],
      dropped: ["offset-or-duplicate"],
      reordered: ["offset-or-duplicate"],
      truncated: ["offset-or-duplicate"],
      duplicate: ["offset-or-duplicate"],
      identity: ["identity-or-order"],
    }
    expect([...new Set(issues)].sort()).toEqual(expectedIssues[fault])
    if (fault === "none") {
      expect(ranges.every((r) => r.text.isWellFormed())).toBe(true)
      expect(Buffer.concat(ranges.map((r) => Buffer.from(r.text)))).toEqual(Buffer.from(text))
    }
  },
)
