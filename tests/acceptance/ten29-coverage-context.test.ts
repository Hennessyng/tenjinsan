import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, it } from "vitest"
import { auditCoveragePath, nativeCoveragePayloads } from "./ten29/coverage-evidence.ts"
import { exerciseContextControl } from "./ten29/evaluator-context-fixture.ts"
import { evaluatorControls } from "./ten29/evaluator-controls-v1.ts"
import { evaluatorContextControls } from "./ten29/evaluator-controls-v2.ts"
import { auditRequiredPassages } from "./ten29/evaluator-passages-v2.ts"
import { exerciseEvaluatorControl } from "./ten29/evaluator-path-fixture.ts"
import { evidenceDirectory } from "./ten29/evidence.ts"

const directory = await evidenceDirectory("coverage-context-v3")
const provenance = {
  version: "TEN29-coverage-path-controls-v3",
  labels: "same-author/unblinded; historical labels unchanged",
  semanticScores: "NOT RUN",
  plan: "fresh explicit bounded plan before grant; no replanning after capacity refusal",
  evidenceFrames:
    "v1 coverage comparison uses compact authored maps (purpose/summary/qualifications/definitions retained), not the legacy rich map frame; no original source removed",
}
it.each(evaluatorContextControls)(
  "loads every original for version3 $id without relying on map qualifications",
  async (control) => {
    // Given / When
    const result = await exerciseContextControl(control, "not-addressed")
    const coverage = auditCoveragePath({
      analysis: result.analysis,
      normalization: result.normalization,
      payloads: result.payloads,
    })
    const passages = auditRequiredPassages({
      normalization: result.normalization,
      payload: coverage.payload,
      required: result.required,
    })
    const path = join(directory, control.id)
    await mkdir(path, { mode: 0o700 })
    await writeFile(
      join(path, "evidence.json"),
      JSON.stringify({ provenance, control, ...result, coverage, passages }, null, 2),
      { flag: "wx", mode: 0o600 },
    )
    // Then
    expect(coverage.audit.missingParts).toEqual([])
    expect(passages.missingPassages).toEqual([])
    expect(result.analysis.status).toBe("successful")
    expect(result.sourceMaps.length).toBeGreaterThanOrEqual(control.minimumMaps)
    if (!control.keepQualifications)
      expect(result.sourceMaps.flatMap((map) => map.qualifications)).toEqual([])
    if (control.minimumMaps > 1 && control.expectedGroups === 1)
      expect(result.analysis.wholeBook?.synthesis?.strategy).toBe("complete-maps")
  },
  30000,
)

it.each(evaluatorControls)(
  "binds full originals to the global candidate for version3 $id",
  async (control) => {
    // Given / When
    const result = await exerciseEvaluatorControl(control, "not-addressed")
    const coverage = auditCoveragePath({
      analysis: result.analysis,
      normalization: result.normalization,
      payloads: nativeCoveragePayloads(result.nativeTurns),
    })
    const path = join(directory, control.id)
    await mkdir(path, { mode: 0o700 })
    await writeFile(
      join(path, "evidence.json"),
      JSON.stringify({ provenance, ...result, coverage }, null, 2),
      { flag: "wx", mode: 0o600 },
    )
    // Then
    expect(coverage.audit.missingParts).toEqual([])
    expect(result.analysis.status).toBe("successful")
    expect(coverage.semanticVerdict).toBe("NOT ASSESSED")
  },
  30000,
)

it.each(["material-omission", "contradicted", "own-map-not-addressed"] as const)(
  "blocks an authored %s state without treating the control as semantic truth",
  async (state) => {
    // Given
    const control = evaluatorControls.find(
      (control) => control.id === "early-only-missed-late-reversal",
    )
    if (!control) throw new TypeError("Missing unchanged historical control")
    // When
    const result = await exerciseEvaluatorControl(control, state)
    const coverage = auditCoveragePath({
      analysis: result.analysis,
      normalization: result.normalization,
      payloads: nativeCoveragePayloads(result.nativeTurns),
    })
    const path = join(directory, state)
    await mkdir(path, { mode: 0o700 })
    await writeFile(
      join(path, "evidence.json"),
      JSON.stringify({ provenance, state, ...result, coverage }, null, 2),
      { flag: "wx", mode: 0o600 },
    )
    // Then
    expect(coverage.audit.missingParts).toEqual([])
    expect(result.structuralOutcome).toMatchObject({ status: "partial", phase: "blocked" })
  },
)

it("fits the original rich disagreement script through deduplication without dropping its findings", async () => {
  // Given
  const control = evaluatorControls.find((control) => control.id === "flattened-disagreement")
  if (!control) throw new TypeError("Missing historical rich control")
  // When
  const result = await exerciseEvaluatorControl(control, "not-addressed", false)
  const coverage = auditCoveragePath({
    analysis: result.analysis,
    normalization: result.normalization,
    payloads: nativeCoveragePayloads(result.nativeTurns),
  })
  const path = join(directory, "rich-deduplicated")
  await mkdir(path, { mode: 0o700 })
  await writeFile(
    join(path, "evidence.json"),
    JSON.stringify(
      { provenance, ...result, coverage, frame: "original rich map, no finding omissions" },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  )
  // Then
  expect(result.analysis.status).toBe("successful")
  expect(coverage.audit.missingParts).toEqual([])
})
