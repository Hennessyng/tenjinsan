import {
  AttemptId,
  Digest,
  type ExternalAttempt,
  JobId,
  Text,
  Timestamp,
  Usage,
} from "@reading-studio/contracts"
import { z } from "zod"

export const ClaimJobInput = z
  .strictObject({ token: Text, now: Timestamp, expiresAt: Timestamp })
  .refine((value) => Date.parse(value.expiresAt) > Date.parse(value.now), "lease must expire later")
  .readonly()

const LeaseFields = z.strictObject({
  jobId: JobId,
  token: Text,
  fence: z.number().int().positive(),
  now: Timestamp,
})
export const LeaseInput = LeaseFields.readonly()
export type LeaseReference = z.infer<typeof LeaseInput>

export const HeartbeatInput = LeaseFields.extend({ expiresAt: Timestamp })
  .refine((value) => Date.parse(value.expiresAt) > Date.parse(value.now), "lease must expire later")
  .readonly()

export const CheckpointInput = LeaseFields.extend({ checkpoint: Digest }).readonly()
export const CompletionInput = LeaseFields.extend({ resultHash: Digest }).readonly()
export const CommitArtifactInput = LeaseFields.extend({ artifact: z.unknown() }).readonly()
export const CancellationInput = z.strictObject({ jobId: JobId }).readonly()
export const PrepareAttemptInput = LeaseFields.extend({
  attemptId: AttemptId,
  preparedAt: Timestamp,
}).readonly()
export const DispatchAttemptInput = LeaseFields.extend({
  attemptId: AttemptId,
  dispatchedAt: Timestamp,
}).readonly()
export const ReceiptAttemptInput = LeaseFields.extend({
  attemptId: AttemptId,
  receivedAt: Timestamp,
  responseBody: z.instanceof(Uint8Array),
  usage: Usage,
}).readonly()
export const ResolveAttemptInput = z
  .strictObject({
    attemptId: AttemptId,
    resolution: z.enum(["retry-approved", "stop-approved"]),
  })
  .readonly()

export type ReserveAttemptResult =
  | { readonly kind: "prepared"; readonly attempt: ExternalAttempt }
  | { readonly kind: "budget-exhausted" }
