import { z } from "zod"
import { Artifact } from "./artifacts.ts"
import { JobId, PublicationRevisionId, Text, Timestamp } from "./primitives.ts"
import { PublicationRevision } from "./publication.ts"
import { EvidenceView } from "./review.ts"

// Bump when either output's composition, validation or rendering changes.
export const PUBLICATION_RENDERER = "html-25-print-26-pdf-27-release-1"
export const PublicationSnapshot = z
  .strictObject({
    publication: PublicationRevision,
    evidence: EvidenceView,
  })
  .refine(
    ({ publication, evidence }) =>
      evidence.ready &&
      publication.lessonRevisionId === evidence.draft.lessonRevisionId &&
      publication.projectionHash === evidence.draft.projectionHash &&
      publication.approval.evidenceReportHash === evidence.reportHash &&
      JSON.stringify(publication.privacyReview) === JSON.stringify(evidence.privacy),
    "publication requires the exact ready review",
  )
  .readonly()
export type PublicationSnapshot = z.infer<typeof PublicationSnapshot>

const output = { id: JobId, publicationId: PublicationRevisionId, format: z.enum(["html", "pdf"]) }
export const PublicationOutput = z
  .discriminatedUnion("state", [
    z.strictObject({
      ...output,
      state: z.literal("queued"),
      expiresAt: z.null(),
      error: z.null(),
      artifact: z.null(),
    }),
    z.strictObject({
      ...output,
      state: z.literal("running"),
      expiresAt: Timestamp,
      error: z.null(),
      artifact: z.null(),
    }),
    z.strictObject({
      ...output,
      state: z.literal("released"),
      expiresAt: Timestamp,
      error: z.null(),
      artifact: Artifact,
    }),
    z.strictObject({
      ...output,
      state: z.literal("failed"),
      expiresAt: Timestamp.nullable(),
      error: Text,
      artifact: z.null(),
    }),
  ])
  .readonly()
export type PublicationOutput = z.infer<typeof PublicationOutput>
