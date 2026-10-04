import { z } from "zod"
import { QuestionSet } from "./choices.ts"
import { Job } from "./execution.ts"
import {
  AnalysisRevision,
  analysisCacheKey,
  StudySetupRevision,
  TransmissionAuthorization,
} from "./lineage.ts"
import { assertNever } from "./primitives.ts"
import { NormalizationRevision } from "./source.ts"

export const StudyAnalysis = z
  .strictObject({ setup: StudySetupRevision, analysis: AnalysisRevision })
  .refine(
    ({ setup, analysis }) =>
      setup.editionId === analysis.editionId &&
      analysisCacheKey(setup.analysis) === analysis.cacheKey,
    "analysis does not match the exact study setup",
  )
  .readonly()
export type StudyAnalysis = z.infer<typeof StudyAnalysis>

export const AnalysisQuestionSet = z
  .strictObject({ analysis: AnalysisRevision, questionSet: QuestionSet })
  .refine(
    ({ analysis, questionSet }) =>
      analysis.status === "successful" && questionSet.analysisRevisionId === analysis.id,
    "discovery requires the exact successful analysis revision",
  )
  .readonly()

export const JobAuthorization = z
  .strictObject({ job: Job, authorization: TransmissionAuthorization })
  .refine(
    ({ job, authorization }) =>
      job.grant.kind === "active" &&
      job.setupRevisionId === authorization.setup.id &&
      job.grant.id === authorization.grant.id &&
      job.grant.ownerId === authorization.ownerId &&
      job.grant.installationId === authorization.installationId &&
      job.provider === authorization.setup.analysis.provider &&
      job.model === authorization.setup.analysis.model,
    "job provider or transmission lineage mismatch",
  )
  .readonly()

export const NormalizedStudySetup = z
  .strictObject({ setup: StudySetupRevision, normalization: NormalizationRevision })
  .refine(
    ({ setup, normalization }) =>
      setup.editionId === normalization.editionId &&
      setup.analysis.editionHash === normalization.editionHash &&
      setup.analysis.normalizationRevisionId === normalization.id &&
      [...setup.analysis.scope.selected, ...setup.analysis.scope.exclusions].every((scope) =>
        normalization.resources.some(
          (resource) =>
            resource.path === scope.resourcePath &&
            resource.status === "included" &&
            scope.blockIds.every((id) => resource.blocks.some((block) => block.id === id)),
        ),
      ),
    "scope does not resolve in the exact normalization revision",
  )
  .superRefine(({ setup, normalization }, ctx) => {
    const scope = setup.analysis.scope
    switch (scope.kind) {
      case "partial":
        return
      case "all-main-chapters": {
        const main = normalization.resources.filter((resource) => resource.role === "main-chapter")
        const complete =
          main.length > 0 &&
          scope.selected.length === main.length &&
          main.every((resource) => {
            switch (resource.status) {
              case "excluded":
                return false
              case "included":
                return scope.selected.some(
                  (selection) =>
                    selection.resourcePath === resource.path &&
                    selection.blockIds.length === resource.blocks.length &&
                    resource.blocks.every((block) => selection.blockIds.includes(block.id)),
                )
              default:
                return assertNever(resource)
            }
          })
        if (!complete)
          ctx.addIssue({
            code: "custom",
            path: ["setup", "analysis", "scope"],
            message: "all-main scope must select exactly every main chapter block",
          })
        return
      }
      default:
        return assertNever(scope)
    }
  })
  .readonly()
