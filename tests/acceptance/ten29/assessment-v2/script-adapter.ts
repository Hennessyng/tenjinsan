import { ChapterPartMap } from "@reading-studio/contracts"
import type { ProviderReceipt, StructuredRequest } from "@reading-studio/providers"
import { z } from "zod"
import { BatchedRuntimeAdapter } from "../../../../apps/worker/tests/whole-book-batch-runtime-fixture.ts"
import { WireRange, wirePayload } from "../processing-evidence.ts"
import type { CandidateBody, FamilyNarrative, StatementScript } from "./control-types.ts"
import type { Location, SourceProjection } from "./source-projection.ts"

const Envelope = z.object({
  kind: z.enum(["chapter-map", "book-synthesis", "batched-original-verification"]),
  interpretations: z.array(z.object({ id: z.string() })).optional(),
  task: z.string().optional(),
})
export class AssessmentScriptAdapter extends BatchedRuntimeAdapter {
  constructor(
    readonly script: {
      readonly candidate: CandidateBody
      readonly narrative: FamilyNarrative
      readonly source: SourceProjection
    },
  ) {
    super()
  }
  override async dispatch(request: StructuredRequest): Promise<ProviderReceipt> {
    this.requests.push(request)
    const payload = wirePayload(request.prompt),
      input = Envelope.parse(payload[0])
    const locations = (parts: readonly number[]): readonly Location[] =>
      parts.flatMap((part) => {
        const source = this.script.source.parts[part]
        if (!source) throw new TypeError("Candidate references absent source part")
        return source.locations
      })
    const statement = (row: StatementScript) => ({
      text: row.text,
      citations: locations(row.parts),
    })
    let output: unknown
    switch (input.kind) {
      case "chapter-map": {
        const ranges = z.array(WireRange).min(1).parse(payload.slice(1))
        const included = this.script.source.parts.filter((part) =>
          part.locations.every((location) =>
            ranges.some(
              (range) =>
                range.resourcePath === location.resourcePath &&
                range.blockId === location.blockId &&
                range.start <= location.start &&
                range.end >= location.end,
            ),
          ),
        )
        if (!included.length)
          throw new TypeError(
            "Window cannot contain a complete scripted part; no truncation allowed",
          )
        const fields: Record<
          "claims" | "definitions" | "examples" | "qualifications" | "uncertainties",
          ReturnType<typeof statement>[]
        > = { claims: [], definitions: [], examples: [], qualifications: [], uncertainties: [] }
        for (const part of included) {
          const authored = this.script.narrative.parts[part.ordinal]
          if (!authored) throw new TypeError("Missing authored part map")
          fields[authored.role].push(statement({ text: authored.text, parts: [part.ordinal] }))
        }
        output = {
          complete: true,
          claimStatus: this.script.candidate.family === "definitions" ? "no-claim" : "claims",
          purpose: null,
          ...fields,
          concepts: [],
          summary: statement({
            text: included.map((part) => this.script.narrative.parts[part.ordinal]?.text).join(" "),
            parts: included.map((part) => part.ordinal),
          }),
        }
        break
      }
      case "book-synthesis": {
        const synthesis = z
          .object({ maps: z.array(ChapterPartMap), groupIds: z.array(z.string()) })
          .parse(payload[0])
        if (!synthesis.maps.length) throw new TypeError("No actual maps supplied to synthesis")
        const candidate = this.script.candidate
        output = {
          complete: true,
          representedGroupIds: synthesis.groupIds,
          thesis: candidate.thesis.map(statement),
          progression: candidate.progression.map(statement),
          connections: candidate.connections.map(statement),
          conflicts: candidate.conflicts.map(statement),
          changesOfPosition: candidate.changesOfPosition.map(statement),
          uncertainties: candidate.uncertainties.map(statement),
        }
        break
      }
      case "batched-original-verification":
        z.array(WireRange).min(1).parse(payload.slice(1))
        output = {
          decisions: (input.interpretations ?? []).map((finding) => ({
            id: finding.id,
            verdict: "supported",
            explanation: "MECHANICAL SCRIPT ACCEPTANCE ONLY; no semantic assessment",
          })),
          mapCoverage:
            input.task === "map-omission"
              ? {
                  verdict: "none",
                  explanation: "Scripted transport fixture; not a human omission assessment",
                  sources: [],
                }
              : null,
        }
        break
      default: {
        const impossible: never = input.kind
        throw new TypeError(String(impossible))
      }
    }
    return {
      kind: "output",
      text: JSON.stringify(output),
      usage: { kind: "known", inputTokens: 10, outputTokens: 10 },
    }
  }
}
