import { pathToFileURL } from "node:url"
import { analysisCacheKey } from "@reading-studio/contracts"
import { openStorage } from "@reading-studio/storage"
import { z } from "zod"

export const MatrixSnapshot = z.object({
  counts: z.object({
    editions: z.number(),
    jobs: z.number(),
    attempts: z.number(),
    grants: z.number(),
    publications: z.number(),
    artifacts: z.number(),
  }),
  setup: z
    .object({
      id: z.string(),
      studyId: z.string(),
      provider: z.string(),
      cacheKey: z.string(),
      analysisId: z.string().nullable(),
      analysisMarker: z.string().nullable(),
      interviewId: z.string().nullable(),
      briefId: z.string().nullable(),
      outlineId: z.string().nullable(),
      lessonId: z.string().nullable(),
      publications: z.number(),
      publicationId: z.string().nullable(),
      projectionHash: z.string().nullable(),
      outputs: z.array(
        z.object({
          id: z.string(),
          format: z.string(),
          state: z.string(),
          error: z.string().nullable(),
          artifactHash: z.string().nullable(),
        }),
      ),
      jobs: z.array(
        z.object({
          id: z.string(),
          runId: z.string(),
          stage: z.string(),
          provider: z.string(),
          state: z.string(),
          reason: z.string().nullable(),
          failureCode: z.string().nullable(),
          grantId: z.string(),
          setupId: z.string(),
          lease: z
            .object({ token: z.string(), fence: z.number(), expiresAt: z.string() })
            .nullable(),
          attempts: z.array(
            z.object({
              id: z.string(),
              state: z.string(),
              resolution: z.string().nullable(),
              usage: z.string().nullable(),
            }),
          ),
        }),
      ),
    })
    .nullable(),
})

export function readMatrixSnapshot(
  databasePath: string,
  privateDataRoot: string,
  setupId?: string,
) {
  const storage = openStorage({ databasePath, privateDataRoot })
  try {
    const setup = setupId ? storage.sources.getSetup(setupId) : null
    const analysis = setup
      ? storage.workflow.findSuccessfulAnalysis(analysisCacheKey(setup.analysis))
      : null
    const studyJobs = setup
      ? storage.execution
          .listOwnerJobs(
            storage.sources
              .listStudiesByEdition(setup.editionId)
              .find((study) => study.id === setup.studyId)?.ownerId ?? "",
          )
          .filter((job) => job.setupRevisionId === setup.id)
      : []
    const publication = setup ? storage.publicationOutputs.list(setup.studyId)[0] : undefined
    return MatrixSnapshot.parse({
      counts: storage.counts(),
      setup: setup
        ? {
            id: setup.id,
            studyId: setup.studyId,
            provider: setup.analysis.provider,
            cacheKey: analysisCacheKey(setup.analysis),
            analysisId: analysis?.id ?? null,
            analysisMarker: analysis?.claims[0]?.text ?? null,
            interviewId: storage.interviews.latest(setup.studyId)?.id ?? null,
            briefId: storage.briefs.current(setup.studyId)?.draft.id ?? null,
            outlineId: storage.outlines.current(setup.studyId)?.draft.id ?? null,
            lessonId: storage.reviews.latestLessonId(setup.studyId),
            publications: storage.publicationOutputs.list(setup.studyId).length,
            publicationId: publication?.publication.id ?? null,
            projectionHash: publication?.publication.projectionHash ?? null,
            outputs: publication
              ? storage.publicationOutputs.outputs(publication.publication.id).map((output) => ({
                  id: output.id,
                  format: output.format,
                  state: output.state,
                  error: output.state === "failed" ? output.error : null,
                  artifactHash: output.state === "released" ? output.artifact.contentHash : null,
                }))
              : [],
            jobs: studyJobs.map((job) => ({
              id: job.id,
              runId: job.runId,
              stage: job.stage,
              provider: job.provider,
              state: job.state,
              reason: job.state === "paused" ? job.reason : null,
              failureCode: job.state === "failed" ? job.error.code : null,
              grantId: job.grant.id,
              setupId: job.setupRevisionId,
              lease: job.state === "running" ? job.lease : null,
              attempts: storage.execution.listAttempts(job.runId).map((attempt) => ({
                id: attempt.id,
                state: attempt.state,
                resolution: attempt.state === "outcome_unknown" ? attempt.resolution : null,
                usage: "usage" in attempt ? attempt.usage.kind : null,
              })),
            })),
          }
        : null,
    })
  } finally {
    storage.close()
  }
}

const executablePath = process.argv[1]
if (executablePath && import.meta.url === pathToFileURL(executablePath).href) {
  const config = z
    .object({ DATABASE_PATH: z.string(), PRIVATE_DATA_ROOT: z.string() })
    .parse(process.env)
  const setupId = z.string().optional().parse(process.argv[2])
  process.stdout.write(
    `${JSON.stringify(readMatrixSnapshot(config.DATABASE_PATH, config.PRIVATE_DATA_ROOT, setupId))}\n`,
  )
}
