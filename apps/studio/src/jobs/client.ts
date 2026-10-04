import { z } from "zod"

export const JobStatus = z.strictObject({
  id: z.string(),
  studyId: z.string(),
  sourceRevisionId: z.string(),
  setupRevisionId: z.string(),
  inputRevisionId: z.string(),
  stage: z.string(),
  state: z.string(),
  reason: z.string().nullable(),
  trace_id: z.string().nullable(),
  explanation: z.string().nullable(),
  checkpoint: z.boolean(),
  section: z.strictObject({ index: z.number(), id: z.string() }).nullable(),
  cancellationRequested: z.boolean(),
  attempts: z.number(),
  retryRemaining: z.number(),
  callBudgetRemaining: z.number(),
  runBudgetRemaining: z.number(),
  usage: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("known"), inputTokens: z.number(), outputTokens: z.number() }),
    z.strictObject({ kind: z.literal("unknown") }),
  ]),
  failureCode: z.string().nullable(),
  canRetry: z.boolean(),
  unknownAttemptId: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
})
export const JobList = z.strictObject({
  jobs: z.array(JobStatus),
  providerCharges: z.literal("not-returned"),
})
export type JobStatus = z.infer<typeof JobStatus>
