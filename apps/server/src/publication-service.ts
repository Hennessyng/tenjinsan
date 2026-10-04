import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import {
  Artifact,
  contentDigest,
  type EvidenceView,
  PUBLICATION_RENDERER,
  type PublicationOutput,
  PublicationSnapshot,
  publicationTeachingStateIds,
} from "@reading-studio/contracts"
import { exportHtml } from "@reading-studio/export/html"
import { exportPdf } from "@reading-studio/export/pdf"
import { openEvidenceReview } from "@reading-studio/generation/review"
import { ContractBoundaryError, type Storage } from "@reading-studio/storage"

export function approvePublication(storage: Storage, view: EvidenceView): PublicationSnapshot {
  const current = openEvidenceReview(storage, view.draft.lessonRevisionId)
  if (
    !current.ready ||
    current.draft.id !== view.draft.id ||
    current.reportHash !== view.reportHash
  )
    throw new ContractBoundaryError("current ready evidence required")
  const existing = storage.publicationOutputs
    .list(view.draft.studyId)
    .find((snapshot) => storage.publicationOutputs.current(snapshot))
  if (existing) return existing
  const lesson = storage.workflow.getLesson(view.draft.lessonRevisionId)
  if (!lesson) throw new ContractBoundaryError("publication lesson")
  const snapshot = PublicationSnapshot.parse({
    evidence: current,
    publication: {
      id: randomUUID(),
      lessonRevisionId: lesson.id,
      analysisRevisionId: lesson.analysisRevisionId,
      projection: current.draft.projection,
      projectionHash: current.draft.projectionHash,
      privacyReview: current.privacy,
      approval: {
        projectionHash: current.draft.projectionHash,
        privacyReviewId: current.privacy.id,
        evidenceReportHash: current.reportHash,
        rendererVersion: PUBLICATION_RENDERER,
        requiredStateIds: publicationTeachingStateIds(current.draft.projection),
        assetHashes: [
          ...new Set(current.draft.projection.assets.map((asset) => asset.contentHash)),
        ],
        approvedAt: new Date().toISOString(),
      },
    },
  })
  return storage.publicationOutputs.approve(snapshot)
}

function requireCurrent(storage: Storage, snapshot: PublicationSnapshot): void {
  const view = openEvidenceReview(storage, snapshot.publication.lessonRevisionId)
  if (
    !storage.publicationOutputs.current(snapshot) ||
    !view.ready ||
    view.reportHash !== snapshot.publication.approval.evidenceReportHash
  )
    throw new ContractBoundaryError("publication approval changed")
}

export async function renderPublicationOutput(
  storage: Storage,
  output: PublicationOutput,
  options: { readonly chromiumExecutablePath?: string } = {},
): Promise<void> {
  if (storage.publicationOutputs.output(output.id)?.state !== "queued") return
  const snapshot = storage.publicationOutputs.get(output.publicationId)
  if (!snapshot) throw new ContractBoundaryError("publication snapshot")
  let claimedByThisCall = false
  try {
    requireCurrent(storage, snapshot)
    const claimed = storage.publicationOutputs.claim(output.id)
    claimedByThisCall = true
    const resolveAsset = (hash: string) => readFile(storage.blobs.pathFor(hash))
    const bytes =
      claimed.format === "html"
        ? Buffer.from(await exportHtml(snapshot.publication, resolveAsset))
        : await exportPdf(snapshot.publication, { resolveAsset, ...options })
    requireCurrent(storage, snapshot)
    const artifact = Artifact.parse({
      id: randomUUID(),
      publicationRevisionId: snapshot.publication.id,
      projectionHash: snapshot.publication.projectionHash,
      format: claimed.format,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      embeddedAssetHashes: snapshot.publication.approval.assetHashes,
      teachingStateIds: snapshot.publication.approval.requiredStateIds,
      validation: {
        status: "passed",
        reportHash: contentDigest(
          JSON.stringify({
            approval: snapshot.publication.approval,
            format: claimed.format,
            bytes: bytes.length,
          }),
        ),
      },
      provenance: {
        jobId: claimed.id,
        rendererVersion: PUBLICATION_RENDERER,
        createdAt: new Date().toISOString(),
      },
    })
    storage.publicationOutputs.release(artifact, bytes)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const latest = storage.publicationOutputs.output(output.id)
    if (latest?.state === "queued" || (claimedByThisCall && latest?.state === "running"))
      storage.publicationOutputs.fail(
        output.id,
        error instanceof ContractBoundaryError ? "stale-approval" : "render-error",
      )
  }
}
