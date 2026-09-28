import type { MatrixDeployment } from "./matrix-driver.ts"
import type { RestoreReceipt } from "./matrix-restore.ts"

type CaseOutcome = {
  readonly name: string
  readonly http: number
  readonly job?: string
  readonly attempts?: readonly string[]
  readonly checks?: {
    readonly multipart: number
    readonly ownerForm: number
    readonly decision: number
    readonly formDecision: number
    readonly upload: number
    readonly artifactPost: number
    readonly forgedHtmlHash: string
    readonly approvedProjectionHash: string
    readonly approvedHtmlHash: string
    readonly approvedPdfHash: string
    readonly projectionAndArtifactsUnchanged: boolean
  }
  readonly restore?: RestoreReceipt
}

export async function recordCase(
  deployment: MatrixDeployment,
  result: CaseOutcome,
  setupId?: string,
) {
  const snapshot = await deployment.snapshot(setupId)
  const setup = snapshot.setup
  return {
    ...result,
    lineage: {
      counts: snapshot.counts,
      setup: setup
        ? {
            id: setup.id,
            studyId: setup.studyId,
            provider: setup.provider,
            cacheKey: setup.cacheKey,
            analysisId: setup.analysisId,
            interviewId: setup.interviewId,
            briefId: setup.briefId,
            outlineId: setup.outlineId,
            lessonId: setup.lessonId,
            publicationId: setup.publicationId,
            projectionHash: setup.projectionHash,
            jobs: setup.jobs.map((job) => ({
              id: job.id,
              runId: job.runId,
              stage: job.stage,
              state: job.state,
              reason: job.reason,
              failureCode: job.failureCode,
              grantId: job.grantId,
              setupId: job.setupId,
              attempts: job.attempts,
            })),
            outputs: setup.outputs,
          }
        : null,
    },
  }
}

export type MatrixCase = Awaited<ReturnType<typeof recordCase>>
