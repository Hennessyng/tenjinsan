import { z } from "zod"
import { ModelSettings } from "./analysis-cache.ts"
import {
  FullBookGroupId,
  FullBookNodeId,
  FullBookTestInput,
  FullBookTestPlan,
} from "./full-book-test-contract.ts"
import { ContentId, Digest, Natural, Text } from "./primitives.ts"
import { SubscriptionDestination } from "./subscriptions.ts"

export const FullBookTestSession = z
  .strictObject({
    enabled: z.literal(true),
    purpose: z.literal("full-book-test-1"),
    input: FullBookTestInput,
    plan: FullBookTestPlan,
    destination: SubscriptionDestination.refine(
      (value) => value.provider === "chatgpt-subscription",
    ),
    model: Text,
    settings: ModelSettings,
  })
  .readonly()
export type FullBookTestSession = z.infer<typeof FullBookTestSession>

export const FullBookFinding = z
  .strictObject({
    id: ContentId,
    kind: z.enum([
      "purpose",
      "summary",
      "claim",
      "concept",
      "definition",
      "example",
      "qualification",
      "counterargument",
      "uncertainty",
    ]),
    groupIds: z.array(FullBookGroupId).min(1).max(4096).readonly(),
    text: z.string().trim().min(1).max(2000),
    citations: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .strictObject({
              kind: z.literal("fragment"),
              fragmentId: Digest,
              start: Natural,
              end: Natural,
            })
            .readonly(),
          z
            .strictObject({
              kind: z.literal("child"),
              nodeId: FullBookNodeId,
              findingId: ContentId,
              outputHash: Digest.optional(),
            })
            .readonly(),
        ]),
      )
      .min(1)
      .max(32)
      .readonly(),
  })
  .readonly()
export type FullBookFinding = z.infer<typeof FullBookFinding>
const Child = z.strictObject({ nodeId: FullBookNodeId, outputHash: Digest }).readonly()
export const FullBookAnalysisOutput = z
  .strictObject({
    kind: z.literal("analysis"),
    policyVersion: z.literal("direct-children-2").optional(),
    targetHash: Digest,
    complete: z.literal(true),
    children: z.array(Child).max(16).readonly(),
    coverage: z.array(Digest).min(1).max(100_000).readonly(),
    groupIds: z.array(FullBookGroupId).min(1).max(4096).readonly(),
    findings: z.array(FullBookFinding).min(1).max(1024).readonly(),
    contributions: z
      .array(
        z
          .strictObject({
            childNodeId: FullBookNodeId,
            childOutputHash: Digest.optional(),
            findingId: ContentId,
            outputFindingIds: z.array(ContentId).min(1).max(1024).readonly(),
            disposition: z.enum(["retained", "qualified", "omitted"]),
            explanation: z.string().trim().min(1).max(2000),
          })
          .readonly(),
      )
      .max(16_384)
      .readonly(),
  })
  .readonly()
export type FullBookAnalysisOutput = z.infer<typeof FullBookAnalysisOutput>
export const FullBookVerificationOutput = z
  .strictObject({
    kind: z.literal("verification"),
    targetHash: Digest,
    decisions: z
      .array(
        z
          .strictObject({
            findingId: ContentId,
            verdict: z.enum([
              "supported",
              "not-addressed",
              "contradicted",
              "qualifies",
              "unsupported",
              "overstated",
              "uncertain",
            ]),
            explanation: z.string().trim().min(1).max(2000),
          })
          .readonly(),
      )
      .max(1024)
      .readonly(),
    materialCoverage: z
      .strictObject({
        verdict: z.enum(["none", "material-omission", "uncertain"]),
        explanation: z.string().trim().min(1).max(2000),
      })
      .readonly()
      .nullable(),
  })
  .readonly()
export const FullBookNotNeeded = z
  .strictObject({
    kind: z.literal("not-needed"),
    policyVersion: z.literal("direct-children-2"),
    targetHash: Digest,
    rootNodeId: FullBookNodeId,
    rootHash: Digest,
    findingCount: z.number().int().positive().max(1024),
    batch: z.number().int().nonnegative(),
  })
  .readonly()
export const FullBookTestOutput = z.discriminatedUnion("kind", [
  FullBookAnalysisOutput,
  FullBookVerificationOutput,
  FullBookNotNeeded,
])
export type FullBookTestOutput = z.infer<typeof FullBookTestOutput>
export const FullBookTestReceipt = z
  .strictObject({
    serialized: z.string().min(1).max(128_000),
    outputHash: Digest,
  })
  .readonly()
export type FullBookTestReceipt = z.infer<typeof FullBookTestReceipt>

export class FullBookOutputError extends Error {
  constructor(
    readonly reason: "lineage" | "citation" | "findings" | "verification" | "incomplete",
  ) {
    super(`Full-book output refused: ${reason}`)
    this.name = "FullBookOutputError"
  }
}
