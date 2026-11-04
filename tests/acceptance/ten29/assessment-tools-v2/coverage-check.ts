import { ControlKind } from "./constructed-schema.ts"
import type { HumanCoverage } from "./coverage-schema.ts"
import type { Manifest } from "./workflow-schema.ts"
export function coverageMatchesConstructed(
  document: Manifest["documents"][number],
  coverage: HumanCoverage,
) {
  return ControlKind.options.every((kind) => {
    const expected = document.candidates
        .filter((candidate) => candidate.constructed.kind === kind)
        .map((candidate) => candidate.candidateCode)
        .sort(),
      row = coverage.rows.find((entry) => entry.kind === kind)
    return (
      !!row &&
      (document.constructedInapplicableKinds.includes(kind)
        ? row.applicability === "not-applicable" && expected.length === 0
        : row.applicability === "applicable" &&
          expected.length > 0 &&
          JSON.stringify([...row.candidateCodes].sort()) === JSON.stringify(expected))
    )
  })
}
