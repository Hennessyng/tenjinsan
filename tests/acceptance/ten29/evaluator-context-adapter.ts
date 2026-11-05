import type { ProviderReceipt, StructuredRequest } from "@reading-studio/providers"
import { z } from "zod"
import { WholeBookAdapter } from "../../../apps/worker/tests/whole-book-fixture.ts"
import type { ContextControl } from "./evaluator-controls-v2.ts"
import { WireRange, wirePayload } from "./processing-evidence.ts"

const Span = z.object({
  resourcePath: z.string(),
  blockId: z.string(),
  start: z.number(),
  end: z.number(),
  originalFragment: z.string(),
})
export class ContextControlAdapter extends WholeBookAdapter {
  constructor(readonly control: ContextControl) {
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
        const locate = (literal: string) =>
          ranges.flatMap((range) => {
            const offset = range.text.indexOf(literal)
            return offset < 0
              ? []
              : [
                  {
                    resourcePath: range.resourcePath,
                    blockId: range.blockId,
                    start: range.start + offset,
                    end: range.start + offset + literal.length,
                  },
                ]
          })
        const claim = locate(this.control.claim)
        const facts = this.control.required.flatMap((requirement) => locate(requirement.text))
        const first = ranges.find((range) => range.text.length > 0)
        if (!first) throw new TypeError("Missing actual map input")
        let units = Math.min(32, first.text.length)
        if (
          first.text.charCodeAt(units - 1) >= 0xd800 &&
          first.text.charCodeAt(units - 1) <= 0xdbff
        )
          units--
        const fallback = {
          resourcePath: first.resourcePath,
          blockId: first.blockId,
          start: first.start,
          end: first.start + units,
        }
        const citations = claim.length ? claim : facts.length ? facts : [fallback]
        const statement = {
          text: "Authored context fixture interpretation; no semantic assessment.",
          citations,
        }
        output = {
          complete: true,
          claimStatus: "uncertain",
          purpose: statement,
          claims: [],
          concepts: [],
          definitions: [],
          examples: [],
          qualifications: this.control.keepQualifications
            ? facts.map((citation) => ({
                text: "Authored source qualification fixture.",
                citations: [citation],
              }))
            : [],
          uncertainties: [],
          summary: statement,
        }
        break
      }
      case "book-synthesis": {
        const input = z
          .object({
            groupIds: z.array(z.string()),
            maps: z.array(z.object({ summary: z.object({ sources: z.array(Span) }) })),
          })
          .parse(payload[0])
        const citation = input.maps
          .flatMap((map) => map.summary.sources)
          .find((span) => span.originalFragment === this.control.claim)
        if (!citation) throw new TypeError("Early claim missing from actual complete maps")
        const { resourcePath, blockId, start, end } = citation
        const statement = {
          text: "The early account is sufficient; scripted candidate only.",
          citations: [{ resourcePath, blockId, start, end }],
        }
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
        output = {
          decisions: input.interpretations.map((finding) => ({
            id: finding.id,
            verdict: "supported",
            explanation:
              "Fixed orchestration script, independent of context audit and not a truth oracle.",
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
