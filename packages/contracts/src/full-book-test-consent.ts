import { z } from "zod"
import { FullBookTestSession } from "./full-book-test-output.ts"
import { OwnerId, ResourcePath, SetupRevisionId, StudyId, Text, Timestamp } from "./primitives.ts"

export const FullBookTestConsent = z
  .strictObject({
    id: z.uuid(),
    version: z.literal("full-book-test-consent-1"),
    transport: z.literal("synthetic-only-no-native-entry"),
    ownerId: OwnerId,
    studyId: StudyId,
    setupRevisionId: SetupRevisionId,
    session: FullBookTestSession,
    sourceCeiling: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    acknowledgement: z
      .strictObject({
        coverage: z.enum(["complete", "partial"]),
        omissions: z
          .array(z.strictObject({ path: ResourcePath, reason: Text }).readonly())
          .readonly(),
      })
      .readonly(),
    approvedAt: Timestamp,
  })
  .readonly()
export type FullBookTestConsent = z.infer<typeof FullBookTestConsent>

export class FullBookConsentError extends Error {
  constructor(
    readonly reason:
      | "authority"
      | "source"
      | "budget"
      | "active"
      | "closed"
      | "inflight"
      | "disabled",
  ) {
    super(`Full-book consent refused: ${reason}`)
    this.name = "FullBookConsentError"
  }
}
