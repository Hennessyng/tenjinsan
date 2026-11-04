import { SubscriptionDestination } from "@reading-studio/contracts/subscriptions"
import { z } from "zod"

const Count = z.number().int().nonnegative()
export const FullBookConsentDetails = z.object({
  runtimeBinding: z.string(),
  recipientBinding: z.string(),
  planBinding: z.string(),
  omissionsHash: z.string(),
  maxAttempts: Count,
  priorSpent: Count,
  priorUnknown: Count,
  priorUsageUnknown: Count,
  priorHeld: Count,
  sourceVersion: Count,
  sourceCeiling: Count,
  coverage: z.enum(["complete", "partial"]),
  omissionCount: Count,
})
export const FullBookRun = z.object({
  id: z.string(),
  setupId: z.string(),
  state: z.enum(["paused", "running", "received", "unknown", "failed", "complete", "cancelled"]),
  purpose: z.literal("experimental-analysis-only"),
  terminal: z.literal("analysis-only").nullable(),
  plannedMaxAttempts: Count,
  plannedMaxJobs: Count,
  usedAttempts: Count,
  completedNodes: Count,
  notNeededNodes: Count,
  unknownAttempts: z.array(z.string()),
  usage: z
    .array(
      z.object({
        id: z.string(),
        state: z.string(),
        usage: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("known"), inputTokens: Count, outputTokens: Count }),
          z.object({ kind: z.literal("unknown") }),
        ]),
      }),
    )
    .optional(),
  retryableUnknownAttempts: z.array(z.string()).optional(),
  revoked: z.boolean(),
  reviewRequired: z.boolean().optional(),
  canResume: z.boolean(),
  canExport: z.boolean(),
  native: z.object({ enabled: z.boolean(), reason: z.string() }),
  runtime: z.object({
    kind: z.enum(["fixture-not-live-evidence", "pinned-codex"]),
    sha256: z.string(),
    version: z.string(),
  }),
  sourceCeiling: Count,
  sourceBudget: z.object({ spent: Count, held: Count, unknown: Count }),
  consentReview: FullBookConsentDetails.extend({ reviewBinding: z.string() }).nullable(),
  downstreamRevisions: z.literal(false),
  readerContextChanged: z.literal(false),
  recipient: SubscriptionDestination.optional(),
  model: z.string().optional(),
  source: z
    .object({
      hash: z.string(),
      coverage: z.enum(["complete", "partial"]),
      omissions: z.array(z.object({ path: z.string(), reason: z.string() })),
    })
    .optional(),
  approvedAt: z.string().optional(),
})
export type FullBookRun = z.infer<typeof FullBookRun>
export const FullBookReview = z
  .object({
    mode: z.literal("full-book-test-1"),
    kind: z.literal("ready"),
    setupId: z.string(),
    reviewBinding: z.string(),
    transmission: z.literal("not-sent"),
    native: z.object({
      enabled: z.boolean(),
      reason: z.literal("release-and-runtime-binding-required"),
    }),
    source: z.object({
      normalizationRevisionId: z.string(),
      sourceHash: z.string(),
      coverage: z.enum(["complete", "partial"]),
      omissions: z.array(z.object({ path: z.string(), reason: z.string() })),
      readableBlocks: Count,
      availableTextUtf8Bytes: Count,
      originalFileIncluded: z.literal(false),
      coverageClaim: z.literal("available-readable-text-not-full-original"),
    }),
    route: z.object({
      provider: z.literal("chatgpt-subscription"),
      model: z.string(),
      binding: z.string(),
      observation: z.literal("stored-only-not-live-readiness"),
      recipient: SubscriptionDestination.optional(),
    }),
    hierarchy: z.object({
      policyVersion: z.string().optional(),
      windows: Count,
      groups: Count,
      levels: Count,
      findingBatches: Count,
      policy: z
        .object({
          fanout: Count,
          maxLevels: Count,
          maxFindings: Count,
          findingsPerBatch: Count,
          maxNodes: Count,
          maxAttempts: Count,
          maxAppBytes: Count,
          maxOutputBytes: Count,
          attemptsPerNode: z.literal(2),
        })
        .optional(),
    }),
    budget: z.object({
      spent: Count,
      held: Count,
      unknown: Count,
      pending: Count,
      proposedMaxJobs: Count,
      proposedMaxAttempts: Count,
      sourceCeiling: Count,
      fits: z.boolean(),
    }),
    warnings: z.object({ en: z.array(z.string()), ja: z.array(z.string()) }),
    runtime: z
      .object({
        collectorBytes: Count.optional(),
        timeoutMs: Count.optional(),
        build: z
          .object({
            kind: z.enum(["fixture-not-live-evidence", "pinned-codex"]),
            sha256: z.string(),
            version: z.string(),
            binding: z.string(),
          })
          .nullable(),
      })
      .optional(),
    consent: FullBookConsentDetails.nullable().optional(),
    canConsent: z.boolean().optional(),
  })
  .readonly()
export type FullBookReview = z.infer<typeof FullBookReview>
export function fullBookOptions(ceiling: number, findings: number) {
  return {
    mode: "full-book-test-1",
    sourceCeiling: ceiling,
    collectorBytes: 128000,
    timeoutMs: 90000,
    policy: {
      fanout: 4,
      maxLevels: 8,
      maxFindings: findings,
      findingsPerBatch: 6,
      maxNodes: 10000,
      maxAttempts: 10000,
      maxAppBytes: 32000,
      maxOutputBytes: 16000,
      attemptsPerNode: 2,
    },
  } as const
}
