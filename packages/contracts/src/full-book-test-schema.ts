import { z } from "zod"
import {
  FullBookAnalysisOutput,
  FullBookFinding,
  type FullBookTestSession,
  FullBookVerificationOutput,
} from "./full-book-test-output.ts"

export function fullBookResponseSchema(session: FullBookTestSession) {
  const direct = session.input.hierarchyPolicy === "direct-children-2"
  const citations = FullBookFinding.unwrap().shape.citations.unwrap()
  const child = citations.element.options[1].unwrap()
  const finding = FullBookFinding.unwrap()
    .extend({
      citations: z
        .array(
          z.discriminatedUnion("kind", [
            citations.element.options[0],
            (direct
              ? child.extend({ outputHash: child.shape.outputHash.unwrap() })
              : child.omit({ outputHash: true })
            ).readonly(),
          ]),
        )
        .min(1)
        .max(32)
        .readonly(),
    })
    .readonly()
  const contribution = FullBookAnalysisOutput.unwrap().shape.contributions.unwrap().element.unwrap()
  const analysis = direct
    ? FullBookAnalysisOutput.unwrap().extend({
        policyVersion: z.literal("direct-children-2"),
        contributions: z
          .array(
            contribution
              .extend({ childOutputHash: contribution.shape.childOutputHash.unwrap() })
              .readonly(),
          )
          .max(16384)
          .readonly(),
      })
    : FullBookAnalysisOutput.unwrap()
        .omit({ policyVersion: true })
        .extend({
          contributions: z
            .array(contribution.omit({ childOutputHash: true }).readonly())
            .max(16384)
            .readonly(),
        })
  return z.toJSONSchema(
    z.discriminatedUnion("kind", [
      analysis
        .extend({
          findings: z.array(finding).min(1).max(session.input.policy.maxFindings).readonly(),
        })
        .readonly(),
      FullBookVerificationOutput,
    ]),
    { reused: "ref" },
  )
}
