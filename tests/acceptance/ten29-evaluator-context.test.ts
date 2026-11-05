import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, it } from "vitest"
import { exerciseContextControl } from "./ten29/evaluator-context-fixture.ts"
import { evaluatorContextControls, evaluatorV2Provenance } from "./ten29/evaluator-controls-v2.ts"
import { auditRequiredPassages } from "./ten29/evaluator-passages-v2.ts"
import { evidenceDirectory } from "./ten29/evidence.ts"

const directory = await evidenceDirectory("evaluator-context-v2")
await writeFile(
  join(directory, "controls-before-run.json"),
  JSON.stringify(
    {
      provenance: evaluatorV2Provenance,
      controls: evaluatorContextControls,
      canonicalSha256: createHash("sha256")
        .update(JSON.stringify(evaluatorContextControls))
        .digest("hex"),
    },
    null,
    2,
  ),
  { mode: 0o600, flag: "wx" },
)
it.each(evaluatorContextControls)(
  "characterizes current source boundaries for $id, not accepted G1 repair behavior",
  async (control) => {
    // Given / When
    const result = await exerciseContextControl(control)
    const path = join(directory, control.id)
    await mkdir(path, { mode: 0o700 })
    await writeFile(
      join(path, "evidence.json"),
      JSON.stringify({ provenance: evaluatorV2Provenance, ...result }, null, 2),
      { mode: 0o600, flag: "wx" },
    )
    // Then: baseline availability only; separately authorized nonlocal repairs must load the originals.
    expect(result.allOriginals.missingParts).toEqual([])
    expect(result.sourceMaps.length).toBeGreaterThanOrEqual(control.minimumMaps)
    expect(result.groupIds).toHaveLength(control.expectedGroups)
    expect(result.synthesisMaps).toEqual(result.sourceMaps)
    expect(result.synthesisGroupIds).toEqual(result.groupIds)
    expect(result.sourceMaps.every((map) => map.complete)).toBe(true)
    if (!control.keepQualifications)
      expect(result.sourceMaps.flatMap((map) => map.qualifications)).toEqual([])
    if (control.minimumMaps > 1)
      for (const passage of result.required)
        expect(
          result.sourceMaps.some((map) =>
            map.summary.sources.some((span) => span.originalFragment === passage.text),
          ),
        ).toBe(true)
    expect(result.audit.missingPassages).toEqual(control.expectedMissing)
    expect(result.audit.semanticVerdict).toBe("NOT ASSESSED")
    const passage = result.required[0]
    if (!passage) throw new TypeError("Missing authored passage")
    expect(() =>
      auditRequiredPassages({
        normalization: result.normalization,
        payload: result.checkPayload,
        required: [{ ...passage, text: "Map text is not a contextual original." }],
      }),
    ).toThrow("authored-passage-reference-mismatch")
  },
  30000,
)
