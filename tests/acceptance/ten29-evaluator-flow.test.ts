import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, it } from "vitest"
import { evaluatorControls, evaluatorProvenance } from "./ten29/evaluator-controls-v1.ts"
import { auditOriginalAssembly } from "./ten29/evaluator-evidence.ts"
import { exerciseEvaluatorControl } from "./ten29/evaluator-path-fixture.ts"
import { evidenceDirectory } from "./ten29/evidence.ts"

const directory = await evidenceDirectory("evaluator-flow-v1")
await writeFile(
  join(directory, "controls-before-run.json"),
  JSON.stringify(
    {
      provenance: evaluatorProvenance,
      controls: evaluatorControls,
      canonicalSha256: createHash("sha256").update(JSON.stringify(evaluatorControls)).digest("hex"),
    },
    null,
    2,
  ),
  { mode: 0o600, flag: "wx" },
)
it.each(evaluatorControls)(
  "inspects actual original evidence assembly for $id without scoring scripted verdicts",
  async (control) => {
    // Given / When
    const result = await exerciseEvaluatorControl(control)
    const caseDirectory = join(directory, control.id)
    await mkdir(caseDirectory, { mode: 0o700 })
    await writeFile(
      join(caseDirectory, "evidence.json"),
      JSON.stringify({ provenance: evaluatorProvenance, ...result }, null, 2),
      { mode: 0o600, flag: "wx" },
    )
    // Then: evidence availability and exact stored source, not the fake verdict's truth.
    expect(result.mappingInputPaths).toEqual(result.required.map((part) => part.resourcePath))
    expect(result.synthesisMaps).toEqual(result.materializedMaps)
    expect(result.synthesisGroupIds).toEqual(result.groupIds)
    expect(result.mappedSourcePaths).toEqual(
      control.mapMode === "full"
        ? result.required.map((part) => part.resourcePath)
        : result.required.slice(0, 1).map((part) => part.resourcePath),
    )
    expect(result.audit.missingParts).toEqual(control.expectedMissingOriginalParts)
    expect(result.audit.semanticVerdict).toBe("NOT ASSESSED")
    const payload = [...result.checkPayload]
    const row = payload[1]
    if (typeof row !== "object" || row === null)
      throw new TypeError("Missing real original for substitution control")
    payload[1] = { ...row, text: "An authored map cannot stand in for the original passage." }
    expect(() =>
      auditOriginalAssembly({
        normalization: result.normalization,
        payload,
        required: result.required,
      }),
    ).toThrow("foreign-or-changed-original-evidence")
  },
  30000,
)
