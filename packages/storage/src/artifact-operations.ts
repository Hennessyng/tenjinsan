import {
  ApprovedArtifact,
  Artifact,
  type Artifact as ArtifactRecord,
} from "@reading-studio/contracts"
import { ExecutionTransitionError } from "./errors.ts"
import { CommitArtifactInput } from "./execution-inputs.ts"
import { type ExecutionStateStore, transitionJob } from "./execution-state.ts"
import { encodeRecord, parseInput } from "./records.ts"
import { artifacts } from "./schema/index.ts"
import type { PublicationRepository } from "./workflow-publication.ts"

export class ArtifactOperations {
  constructor(
    private readonly state: ExecutionStateStore,
    private readonly publications: PublicationRepository,
  ) {}

  commit(input: unknown): ArtifactRecord {
    const parsed = parseInput(CommitArtifactInput, input, "artifact commit")
    const artifact = parseInput(Artifact, parsed.artifact, "artifact")
    const publication = this.publications.getPublication(artifact.publicationRevisionId)
    if (publication === null) {
      throw new ExecutionTransitionError("publication", artifact.publicationRevisionId, "persisted")
    }
    parseInput(ApprovedArtifact, { publication, artifact }, "approved artifact")
    return this.state.immediate("artifact commit", artifact.id, () => {
      const claim = this.state.requireClaim(parsed)
      if (claim.job.cancellationRequested || artifact.provenance.jobId !== claim.job.id) {
        throw new ExecutionTransitionError("artifact", artifact.id, "current claimed job")
      }
      this.state.context.db
        .insert(artifacts)
        .values({
          id: artifact.id,
          publicationRevisionId: artifact.publicationRevisionId,
          jobId: artifact.provenance.jobId,
          contentHash: artifact.contentHash,
          recordJson: encodeRecord(artifact),
        })
        .run()
      this.state.writeJob(
        transitionJob(claim.job, { state: "completed", resultHash: artifact.contentHash }),
        claim.fence,
      )
      return artifact
    })
  }
}
