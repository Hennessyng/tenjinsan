import { COVERAGE_VERIFICATION_VERSION, CoverageMapReferences } from "@reading-studio/contracts"
import type { StructuredRequest } from "@reading-studio/providers"
import { z } from "zod"
import { WholeBookAdapter } from "../../../apps/worker/tests/whole-book-fixture.ts"
import { WireRange, wirePayload } from "./processing-evidence.ts"

export type CoverageState =
  | "not-addressed"
  | "material-omission"
  | "contradicted"
  | "own-map-not-addressed"
const Envelope = z.object({
  kind: z.string(),
  verificationVersion: z.string().optional(),
  scope: z.object({ kind: z.enum(["window", "synthesis"]) }).optional(),
  map: CoverageMapReferences.nullable().optional(),
  interpretations: z.array(z.object({ id: z.string() })).optional(),
})

export class CoverageControlAdapter extends WholeBookAdapter {
  constructor(
    readonly authored: WholeBookAdapter,
    readonly state: CoverageState = "not-addressed",
    readonly compactMap = false,
  ) {
    super()
  }
  override async dispatch(request: StructuredRequest) {
    const result = await this.authored.dispatch(request)
    this.requests.push(request)
    const payload = wirePayload(request.prompt)
    const input = Envelope.parse(payload[0])
    if (this.compactMap && input.kind === "chapter-map" && result.kind === "output") {
      const output = z.record(z.string(), z.unknown()).parse(JSON.parse(result.text))
      return {
        ...result,
        text: JSON.stringify({ ...output, claims: [], examples: [], uncertainties: [] }),
      }
    }
    if (input.verificationVersion !== COVERAGE_VERIFICATION_VERSION) return result
    const originals = z.array(WireRange).parse(payload.slice(1))
    const map = input.map
    const mapIds = new Set(
      map
        ? [
            ...(map.purpose ? [map.purpose] : []),
            ...map.claims,
            ...map.concepts,
            ...map.definitions,
            ...map.examples,
            ...map.qualifications,
            ...map.uncertainties,
            map.summary,
          ]
        : [],
    )
    const window = input.scope?.kind === "window"
    const source = originals[0]
    if (!source) throw new TypeError("Missing source-bound scripted check")
    const verdict = (id: string) => {
      if (!window) return "supported"
      switch (this.state) {
        case "not-addressed":
          return mapIds.has(id) ? "supported" : "not-addressed"
        case "material-omission":
          return "supported"
        case "contradicted":
          return mapIds.has(id) ? "supported" : "contradicted"
        case "own-map-not-addressed":
          return mapIds.has(id) ? "not-addressed" : "supported"
        default: {
          const impossible: never = this.state
          throw new TypeError(String(impossible))
        }
      }
    }
    const { resourcePath, blockId, start, end } = source
    return {
      ...result,
      kind: "output" as const,
      text: JSON.stringify({
        decisions: (input.interpretations ?? []).map((finding) => ({
          id: finding.id,
          verdict: verdict(finding.id),
          explanation: "Authored protocol state, not a semantic judgment.",
        })),
        mapCoverage: window
          ? {
              verdict: this.state === "material-omission" ? "material-omission" : "none",
              explanation: "Authored omission-state control; not independent understanding.",
              sources:
                this.state === "material-omission" ? [{ resourcePath, blockId, start, end }] : [],
            }
          : null,
      }),
    }
  }
}
