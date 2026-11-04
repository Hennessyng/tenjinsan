import { z } from "zod"
import { WindowOriginal } from "./coverage-verification.ts"
import { BlockId, Digest, Natural, Text } from "./primitives.ts"
import { NormalizationRevision } from "./source.ts"

export const FullBookNodeId = z
  .string()
  .regex(/^fb-[0-9]+$/)
  .brand<"FullBookNodeId">()
export type FullBookNodeId = z.infer<typeof FullBookNodeId>
export const FullBookGroupId = Text.brand<"FullBookGroupId">()
export const FullBookTestInput = z
  .strictObject({
    version: z.literal("full-book-test-1"),
    hierarchyPolicy: z.literal("direct-children-2").optional(),
    purpose: z.literal("experimental-analysis-only"),
    routeEvidence: z.literal("experimental-app-guards-not-live-certificate"),
    normalization: NormalizationRevision,
    groups: z
      .array(
        z
          .strictObject({
            id: FullBookGroupId,
            blockIds: z.array(BlockId).min(1).readonly(),
          })
          .readonly(),
      )
      .min(1)
      .max(4096)
      .readonly(),
    windows: z.array(z.array(WindowOriginal).min(1).readonly()).min(1).max(1024).readonly(),
    policy: z
      .strictObject({
        fanout: z.number().int().min(2).max(16),
        maxLevels: z.number().int().min(1).max(16),
        maxFindings: z.number().int().min(1).max(1024),
        findingsPerBatch: z.number().int().min(1).max(64),
        maxNodes: z.number().int().min(1).max(10_000),
        maxAttempts: z.number().int().min(1).max(10_000),
        maxAppBytes: z.number().int().min(1).max(128_000),
        maxOutputBytes: z.number().int().min(1).max(128_000),
        attemptsPerNode: z.literal(2),
      })
      .readonly(),
  })
  .readonly()
export type FullBookTestInput = z.infer<typeof FullBookTestInput>

export const FullBookTestNode = z
  .strictObject({
    id: FullBookNodeId,
    kind: z.enum(["map", "reduce", "map-check", "final-check", "citation-check"]),
    children: z.array(FullBookNodeId).readonly(),
    window: Natural.nullable(),
    batch: Natural.nullable(),
    level: Natural,
  })
  .readonly()
export type FullBookTestNode = z.infer<typeof FullBookTestNode>
export const FullBookTestPlan = z
  .strictObject({
    version: z.literal("full-book-test-1"),
    purpose: z.literal("experimental-analysis-only"),
    routeEvidence: z.literal("experimental-app-guards-not-live-certificate"),
    inputHash: Digest,
    nodes: z.array(FullBookTestNode).min(1).max(10_000).readonly(),
    root: FullBookNodeId,
    findingBatches: Natural,
    maxAttempts: Natural,
  })
  .readonly()
export type FullBookTestPlan = z.infer<typeof FullBookTestPlan>

export class FullBookTestError extends Error {
  constructor(readonly reason: "source" | "budget" | "graph" | "bytes") {
    super(`Full-book test refused: ${reason}`)
    this.name = "FullBookTestError"
  }
}
