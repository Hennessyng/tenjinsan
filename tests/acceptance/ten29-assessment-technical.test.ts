import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, it } from "vitest"
import { observeScriptedCandidate } from "./ten29/assessment-tools-v2/observe-scripted.ts"
import { candidateBodies } from "./ten29/assessment-v2/controls.ts"
import { evidenceDirectory } from "./ten29/evidence.ts"

it.each(candidateBodies)(
  "observes bounded scripted authority/processing evidence for $privateId without grading",
  async (candidate) => {
    const evidence = await observeScriptedCandidate(candidate)
    expect(evidence.technical.incompleteIncludedProcessing).toBe(false)
    expect(evidence.technical.unauthorizedAuthorityChange).toBe(false)
    expect(evidence.technical.citationLocationsResolved).toBe(true)
    const directory = await evidenceDirectory("observed-machine-evidence")
    await writeFile(
      join(directory, "technical.json"),
      JSON.stringify({ privateId: candidate.privateId, ...evidence }, null, 2),
    )
  },
  60000,
)
