import { z } from "zod"
import {
  ArtifactId,
  Digest,
  JobId,
  PublicationRevisionId,
  Text,
  Timestamp,
  uniqueValues,
} from "./primitives.ts"
import { PublicationRevision } from "./publication.ts"
import { TeachingStateId } from "./scenes.ts"

export const Artifact = z
  .strictObject({
    id: ArtifactId,
    publicationRevisionId: PublicationRevisionId,
    projectionHash: Digest,
    format: z.enum(["html", "pdf"]),
    contentHash: Digest,
    embeddedAssetHashes: uniqueValues(Digest),
    teachingStateIds: uniqueValues(TeachingStateId),
    validation: z
      .discriminatedUnion("status", [
        z.strictObject({ status: z.literal("passed"), reportHash: Digest }),
        z.strictObject({
          status: z.literal("failed"),
          reportHash: Digest,
          codes: uniqueValues(Text).refine((codes) => codes.length > 0),
        }),
      ])
      .readonly(),
    provenance: z
      .strictObject({ jobId: JobId, rendererVersion: Text, createdAt: Timestamp })
      .readonly(),
  })
  .readonly()
export type Artifact = z.infer<typeof Artifact>
export const ApprovedArtifact = z
  .strictObject({ publication: PublicationRevision, artifact: Artifact })
  .refine(
    ({ publication, artifact }) =>
      artifact.publicationRevisionId === publication.id &&
      artifact.projectionHash === publication.projectionHash &&
      artifact.validation.status === "passed" &&
      artifact.provenance.rendererVersion === publication.approval.rendererVersion &&
      artifact.teachingStateIds.length === publication.approval.requiredStateIds.length &&
      publication.approval.requiredStateIds.every((id) => artifact.teachingStateIds.includes(id)) &&
      artifact.embeddedAssetHashes.length === publication.approval.assetHashes.length &&
      publication.approval.assetHashes.every((hash) => artifact.embeddedAssetHashes.includes(hash)),
    "artifact does not match approved publication",
  )
  .readonly()
