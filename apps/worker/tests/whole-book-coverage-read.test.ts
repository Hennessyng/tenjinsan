import { DatabaseSync } from "node:sqlite"
import { CoverageVerification, contentDigest } from "@reading-studio/contracts"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { coverageFixture, finishCoverage } from "./whole-book-coverage-fixture.ts"

const fixtures: Awaited<ReturnType<typeof coverageFixture>>[] = []
const Trigger = z.object({ name: z.string().regex(/^[a-zA-Z0-9_]+$/u) })
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it.each(["get", "cache"] as const)(
  "rejects corrupted source-window fragments on %s instead of trusting valid record shape",
  async (mode) => {
    // Given
    const fixture = await coverageFixture()
    fixtures.push(fixture)
    const { analysis } = await finishCoverage(fixture)
    const data = analysis.wholeBook
    if (!data) throw new TypeError("Missing preparation")
    const corrupted = {
      ...analysis,
      wholeBook: {
        ...data,
        verification: data.verification.map((check) => {
          const coverage = check.coverage
          if (coverage?.target.kind !== "window") return check
          const target = {
            ...coverage.target,
            originals: coverage.target.originals.map((span) => ({
              ...span,
              originalFragment: span.originalFragment.replace("Late exception", "Late amendment"),
            })),
          }
          const replacement = CoverageVerification.parse({
            ...coverage,
            target,
            targetHash: contentDigest(JSON.stringify(target)),
          })
          return { ...check, targetHash: replacement.targetHash, coverage: replacement }
        }),
      },
    }
    const db = new DatabaseSync(fixture.databasePath)
    try {
      for (const row of db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='analysis_revisions'",
        )
        .all()) {
        const { name } = Trigger.parse(row)
        db.exec(`DROP TRIGGER "${name}"`)
      }
      db.prepare("UPDATE analysis_revisions SET record_json=? WHERE id=?").run(
        JSON.stringify(corrupted),
        analysis.id,
      )
    } finally {
      db.close()
    }
    // When / Then
    expect(() =>
      mode === "get"
        ? fixture.storage.workflow.getAnalysis(analysis.id)
        : fixture.storage.workflow.findSuccessfulAnalysis(analysis.cacheKey),
    ).toThrow("analysis original passage mismatch")
  },
)
