import type { ProviderReceipt, StructuredRequest } from "@reading-studio/providers"
import { z } from "zod"
import { WholeBookAdapter } from "../../../apps/worker/tests/whole-book-fixture.ts"
import type { EvaluatorControl } from "./evaluator-controls-v1.ts"
import { WireRange, wirePayload } from "./processing-evidence.ts"

const Span = z.object({
  resourcePath: z.string(),
  blockId: z.string(),
  start: z.number(),
  end: z.number(),
})
const SynthesisEnvelope = z.object({
  groupIds: z.array(z.string()),
  maps: z.array(
    z.object({
      purpose: z.object({ sources: z.array(Span) }).nullable(),
      summary: z.object({ sources: z.array(Span) }),
    }),
  ),
})
export class EvidenceControlAdapter extends WholeBookAdapter {
  constructor(readonly control: EvaluatorControl) {
    super()
  }
  override async dispatch(request: StructuredRequest): Promise<ProviderReceipt> {
    this.requests.push(request)
    const payload = wirePayload(request.prompt)
    const envelope = z
      .object({ kind: z.enum(["chapter-map", "book-synthesis", "original-verification"]) })
      .parse(payload[0])
    let output: unknown
    switch (envelope.kind) {
      case "chapter-map": {
        const ranges = z.array(WireRange).parse(payload.slice(1))
        const cite = (index: number, quote: string | null = null) => {
          const range = ranges[index]
          if (!range) throw new TypeError("Missing authored source part")
          const offset = quote === null ? 0 : range.text.indexOf(quote)
          if (offset < 0) throw new TypeError("Authored quote absent from actual original")
          return {
            resourcePath: range.resourcePath,
            blockId: range.blockId,
            start: range.start + offset,
            end: quote === null ? range.end : range.start + offset + quote.length,
          }
        }
        const full = this.control.mapMode === "full"
        const selected = full ? ranges.map((_, index) => index) : [0]
        const statement = (index: number) => ({
          text: ranges[index]?.text ?? "",
          citations: [cite(index)],
        })
        const purpose = { text: ranges[0]?.text ?? "", citations: [cite(0, this.control.quote)] }
        output = {
          complete: true,
          claimStatus: this.control.family === "definitions" ? "no-claim" : "claims",
          purpose,
          claims: this.control.family === "definitions" ? [] : selected.map(statement),
          concepts: [],
          definitions: this.control.family === "definitions" ? selected.map(statement) : [],
          examples: full ? [statement(3)] : [],
          qualifications: this.control.qualificationParts.map(statement),
          uncertainties: full && this.control.family === "chronology" ? [statement(2)] : [],
          summary: {
            text: "Authored fixture map, not independently generated understanding.",
            citations: selected.map((index) => cite(index)),
          },
        }
        break
      }
      case "book-synthesis": {
        const input = SynthesisEnvelope.parse(payload[0])
        const map = input.maps[0]
        if (!map) throw new TypeError("Missing complete map")
        const citations =
          this.control.quote !== null
            ? map.purpose?.sources
            : this.control.citationParts.map((index) => map.summary.sources[index])
        if (!citations?.length || citations.some((citation) => !citation))
          throw new TypeError("Control citation absent from supplied complete maps")
        const statement = { text: this.control.candidate, citations }
        output = {
          complete: true,
          representedGroupIds: input.groupIds,
          thesis: [statement],
          progression: [statement],
          connections: [],
          conflicts: [],
          changesOfPosition: [],
          uncertainties: [],
        }
        break
      }
      case "original-verification": {
        const input = z
          .object({ interpretations: z.array(z.object({ id: z.string() })) })
          .parse(payload[0])
        z.array(WireRange).min(1).parse(payload.slice(1))
        output = {
          decisions: input.interpretations.map((finding) => ({
            id: finding.id,
            verdict: "supported",
            explanation: "Fixed protocol script for every control; never a semantic oracle.",
          })),
        }
        break
      }
      default: {
        const impossible: never = envelope.kind
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
