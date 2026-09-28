import { z } from "zod"
import { Provider, TransmissionGrant } from "./lineage.ts"
import {
  AttemptId,
  Digest,
  InputRevisionId,
  JobId,
  Natural,
  RunId,
  SetupRevisionId,
  Text,
  Timestamp,
} from "./primitives.ts"

export const RunBudget = z
  .strictObject({
    maxCalls: z.number().int().positive().max(10000).default(64),
    maxSourceCharacters: z.number().int().positive().max(1_000_000).default(32000),
    maxOutputTokens: z.number().int().positive().max(1_000_000).default(6000),
    maxTransientRetries: z.number().int().min(0).max(2).default(2),
    maxSchemaRepairs: z.number().int().min(0).max(1).default(1),
  })
  .readonly()
export type RunBudget = z.infer<typeof RunBudget>
export const GenerationRun = z
  .strictObject({
    id: RunId,
    inputRevisionId: InputRevisionId,
    budget: RunBudget,
    reservedCalls: Natural,
    state: z.enum(["running", "paused", "cancelled", "completed", "failed"]),
  })
  .refine((run) => run.reservedCalls <= run.budget.maxCalls, "reserved calls exceed durable budget")
  .readonly()
export type GenerationRun = z.infer<typeof GenerationRun>
export const Usage = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("known"), inputTokens: Natural, outputTokens: Natural }),
    z.strictObject({ kind: z.literal("unknown") }),
  ])
  .readonly()
const attempt = {
  id: AttemptId,
  runId: RunId,
  reservation: z.number().int().positive(),
  inputRevisionId: InputRevisionId,
  preparedAt: Timestamp,
}
export const ExternalAttempt = z
  .discriminatedUnion("state", [
    z.strictObject({ ...attempt, state: z.literal("prepared") }),
    z.strictObject({ ...attempt, state: z.literal("dispatching"), dispatchedAt: Timestamp }),
    z.strictObject({
      ...attempt,
      state: z.literal("response-received"),
      retryApproved: z.literal(true).optional(),
      dispatchedAt: Timestamp,
      receivedAt: Timestamp,
      responseHash: Digest,
      usage: Usage,
    }),
    z.strictObject({
      ...attempt,
      state: z.literal("outcome_unknown"),
      dispatchedAt: Timestamp,
      usage: z.strictObject({ kind: z.literal("unknown") }).readonly(),
      resolution: z.enum(["awaiting-owner", "retry-approved", "stop-approved"]),
    }),
  ])
  .superRefine((value, ctx) => {
    if ("dispatchedAt" in value && Date.parse(value.dispatchedAt) < Date.parse(value.preparedAt))
      ctx.addIssue({ code: "custom", message: "dispatch precedes preparation" })
    if ("receivedAt" in value && Date.parse(value.receivedAt) < Date.parse(value.dispatchedAt))
      ctx.addIssue({ code: "custom", message: "receipt precedes dispatch" })
  })
  .readonly()
export type ExternalAttempt = z.infer<typeof ExternalAttempt>
export const RunAttempts = z
  .strictObject({ run: GenerationRun, attempts: z.array(ExternalAttempt).readonly() })
  .refine(
    ({ run, attempts }) =>
      attempts.length === run.reservedCalls &&
      new Set(attempts.map((entry) => entry.id)).size === attempts.length &&
      new Set(attempts.map((entry) => entry.reservation)).size === attempts.length &&
      attempts.every(
        (entry) =>
          entry.runId === run.id &&
          entry.inputRevisionId === run.inputRevisionId &&
          entry.reservation <= run.reservedCalls,
      ) &&
      (run.state !== "running" ||
        !attempts.some(
          (entry) => entry.state === "outcome_unknown" && entry.resolution === "awaiting-owner",
        )),
    "attempt ledger does not match run budget or pause state",
  )
  .readonly()
const job = {
  id: JobId,
  runId: RunId,
  inputRevisionId: InputRevisionId,
  setupRevisionId: SetupRevisionId,
  provider: Provider,
  model: Text,
  promptVersion: Text,
  schemaVersion: Text,
  grant: TransmissionGrant,
  stage: z.enum([
    "analysis",
    "synthesis",
    "questions",
    "brief",
    "outline",
    "lesson",
    "evidence",
    "publication",
    "artifact",
  ]),
  checkpoint: Digest.nullable(),
  cancellationRequested: z.boolean(),
  usage: Usage,
}
export const Job = z
  .discriminatedUnion("state", [
    z.strictObject({ ...job, state: z.literal("queued") }),
    z.strictObject({
      ...job,
      state: z.literal("running"),
      lease: z
        .strictObject({
          token: Text,
          fence: z.number().int().positive(),
          heartbeatAt: Timestamp,
          expiresAt: Timestamp,
        })
        .refine((lease) => Date.parse(lease.expiresAt) > Date.parse(lease.heartbeatAt))
        .readonly(),
    }),
    z.strictObject({
      ...job,
      state: z.literal("paused"),
      reason: z.enum(["outcome_unknown", "budget-exhausted", "owner", "restored"]),
    }),
    z.strictObject({
      ...job,
      state: z.literal("failed"),
      error: z.strictObject({ code: Text, retryable: z.boolean() }).readonly(),
    }),
    z.strictObject({ ...job, state: z.literal("completed"), resultHash: Digest }),
    z.strictObject({ ...job, state: z.literal("cancelled") }),
  ])
  .refine(
    (value) => value.grant.setupRevisionId === value.setupRevisionId,
    "job grant setup mismatch",
  )
  .refine(
    (value) =>
      value.grant.kind === "active" ||
      (value.grant.kind === "historical" &&
        value.state === "paused" &&
        value.reason === "restored"),
    "only restored paused jobs may carry historical grants",
  )
  .readonly()
export type Job = z.infer<typeof Job>
