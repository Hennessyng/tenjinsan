import {
  AnalysisEvaluationPurpose,
  Digest,
  GrantId,
  SetupRevisionId,
  StudyId,
} from "@reading-studio/contracts"
import { z } from "zod"
import { StorageError } from "./errors.ts"

export const LiveStudyTarget = z
  .strictObject({
    authorizationId: z.uuid().brand<"LiveStudyAuthorizationId">(),
    studyId: StudyId,
    setupRevisionId: SetupRevisionId,
    model: z.string().trim().min(1),
    sourceHash: Digest,
    budgetId: z.uuid().optional(),
    attemptLimit: z.number().int().min(1).max(20).optional(),
    purpose: AnalysisEvaluationPurpose.optional(),
    grantId: GrantId.optional(),
  })
  .refine(
    (target) => (target.budgetId === undefined) === (target.attemptLimit === undefined),
    "shared budget and limit must be explicit together",
  )
  .readonly()
  .refine(
    (target) =>
      target.purpose
        ? target.grantId === `grant-${target.setupRevisionId}`
        : target.grantId === undefined,
    "explicit purpose grant binding required",
  )
export type LiveStudyTarget = z.infer<typeof LiveStudyTarget>
export class LiveStudyGuardError extends StorageError {
  constructor(
    readonly code:
      | "target-mismatch"
      | "history-not-fresh"
      | "counter-unknown"
      | "outcome-unknown"
      | "explicit-target-required"
      | "retired"
      | "budget-mismatch"
      | "budget-restored"
      | "work-in-flight"
      | "adoption-required",
  ) {
    super(`Live study stopped: ${code}`)
  }
}
export function configuredLiveStudyTarget(value: string | undefined): LiveStudyTarget | undefined {
  return value === undefined ? undefined : LiveStudyTarget.parse(JSON.parse(value))
}
