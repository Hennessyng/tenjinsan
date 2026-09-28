import {
  AnalysisRevision,
  AnalysisRevisionId,
  Bilingual,
  InputRevisionId,
  OptionId,
  QuestionId,
  QuestionRevisionId,
  SourceSpan,
  StudyId,
  Text,
  uniqueItems,
  uniqueValues,
} from "@reading-studio/contracts"
import { z } from "zod"

export const DiscoveryInput = z
  .strictObject({
    analysis: AnalysisRevision,
    context: z
      .strictObject({
        revisionId: InputRevisionId,
        studyId: StudyId,
        preferredGoalKeys: uniqueValues(Text),
        customQuestion: Text.nullable(),
      })
      .readonly(),
    expected: z
      .strictObject({
        analysisRevisionId: AnalysisRevisionId,
        contextRevisionId: InputRevisionId,
        studyId: StudyId,
      })
      .readonly(),
  })
  .refine(
    ({ analysis, context, expected }) =>
      analysis.status === "successful" &&
      analysis.id === expected.analysisRevisionId &&
      context.revisionId === expected.contextRevisionId &&
      context.studyId === expected.studyId,
    "discovery requires exact successful analysis and context revisions",
  )
  .readonly()

const Lens = z
  .strictObject({
    id: QuestionId,
    revisionId: QuestionRevisionId,
    groupId: Text,
    learningGoalKey: Text,
    label: Bilingual,
    rationale: Bilingual,
    sources: z.array(SourceSpan).min(1).readonly(),
    complications: z
      .array(
        z
          .strictObject({
            label: Bilingual,
            sources: z.array(SourceSpan).min(1).readonly(),
          })
          .readonly(),
      )
      .min(1)
      .readonly(),
    prompt: Bilingual,
    mode: z.enum(["single", "multi"]),
    minSelections: z.number().int().positive(),
    maxSelections: z.number().int().positive(),
    options: uniqueItems(
      z
        .strictObject({
          id: OptionId,
          goalKey: Text,
          label: Bilingual,
          rationale: Bilingual,
        })
        .readonly(),
    ).refine((options) => options.length > 0),
  })
  .readonly()

export const DiscoveryDraft = z
  .strictObject({
    analysisRevisionId: AnalysisRevisionId,
    contextRevisionId: InputRevisionId,
    groups: uniqueItems(z.strictObject({ id: Text, label: Bilingual }).readonly()).refine(
      (groups) => groups.length > 0,
    ),
    lenses: uniqueItems(Lens).refine((lenses) => lenses.length > 0),
  })
  .superRefine((draft, ctx) => {
    const options = draft.lenses.flatMap((lens) => lens.options.map((option) => option.id))
    if (new Set(options).size !== options.length)
      ctx.addIssue({ code: "custom", message: "duplicate option IDs" })
    const revisions = draft.lenses.map((lens) => lens.revisionId)
    if (new Set(revisions).size !== revisions.length)
      ctx.addIssue({ code: "custom", message: "duplicate question revision IDs" })
    for (const lens of draft.lenses) {
      if (!draft.groups.some((group) => group.id === lens.groupId))
        ctx.addIssue({ code: "custom", message: "unknown lens group" })
      if (
        lens.minSelections > lens.maxSelections ||
        lens.maxSelections > lens.options.length ||
        (lens.mode === "single" && (lens.minSelections !== 1 || lens.maxSelections !== 1))
      )
        ctx.addIssue({ code: "custom", message: "illegal choice bounds" })
    }
  })
  .readonly()

export class DiscoveryError extends Error {
  override readonly name = "DiscoveryError"
  constructor(readonly code: "revision-mismatch" | "invalid-citation" | "deduplicated-bounds") {
    super(code)
  }
}
