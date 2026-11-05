import { Bilingual } from "@reading-studio/contracts"
import {
  DiscoveryDraft,
  DiscoveryError,
  generateQuestions,
} from "@reading-studio/generation/questions"
import { ProviderError } from "@reading-studio/providers"
import { z } from "zod"
import { persistedQuestionIdentity } from "./persisted-question-identity.ts"
import {
  QUESTION_REFERENCE_VERSION,
  questionReferenceCatalog,
} from "./question-reference-catalog.ts"

export function questionReferenceContract(raw: unknown) {
  const catalog = questionReferenceCatalog(raw)
  const { setup, analysis, contextRevisionId } = catalog.input
  const shape = DiscoveryDraft.unwrap().shape
  const domainLens = shape.lenses.unwrap().element.unwrap()
  const Reference = z.enum(catalog.citations.map((item) => item.id))
  const References = z
    .array(Reference)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Duplicate evidence references",
      params: { rule: "approved-question-reference" },
    })
    .readonly()
  const lens = domainLens
    .omit({ revisionId: true, sources: true, complications: true })
    .extend({
      options: domainLens.shape.options.unwrap().min(1).readonly(),
      evidenceRefs: References,
      complications: z
        .array(z.strictObject({ label: Bilingual, evidenceRefs: References }).readonly())
        .min(1)
        .readonly(),
    })
    .readonly()
  const Wire = z.strictObject({
    version: z.enum([QUESTION_REFERENCE_VERSION]),
    binding: z.enum([catalog.binding]),
    groups: shape.groups.unwrap().min(1).readonly(),
    lenses: z.array(lens).min(1).readonly(),
  })
  type Wire = z.infer<typeof Wire>
  const hydrate = (wire: Wire) =>
    DiscoveryDraft.parse({
      analysisRevisionId: analysis.id,
      contextRevisionId,
      groups: wire.groups,
      lenses: wire.lenses.map(({ evidenceRefs, complications, ...item }, position) => ({
        ...item,
        revisionId: persistedQuestionIdentity({
          setup,
          analysisRevisionId: analysis.id,
          contextRevisionId,
          position,
        }).revisionId,
        sources: evidenceRefs.map(catalog.resolve),
        complications: complications.map((entry) => ({
          label: entry.label,
          sources: entry.evidenceRefs.map(catalog.resolve),
        })),
      })),
    })
  const schema = Wire.superRefine((wire, context) => {
    try {
      generateQuestions(
        {
          analysis,
          context: {
            revisionId: contextRevisionId,
            studyId: setup.studyId,
            preferredGoalKeys: [],
            customQuestion: null,
          },
          expected: { analysisRevisionId: analysis.id, contextRevisionId, studyId: setup.studyId },
        },
        hydrate(wire),
      )
    } catch (error) {
      if (!(error instanceof DiscoveryError || error instanceof z.ZodError)) throw error
      let rule = "question-choice-contract"
      if (error instanceof DiscoveryError) {
        const code = error.code
        switch (code) {
          case "revision-mismatch":
            rule = "approved-question-binding"
            break
          case "invalid-citation":
            rule = "approved-question-reference"
            break
          case "deduplicated-bounds":
            break
          default:
            throw new TypeError(`Unknown discovery failure: ${code satisfies never}`)
        }
      }
      context.addIssue({
        code: "custom",
        message: "Question domain contract rejected",
        params: { rule },
      })
    }
  }).readonly()
  const parse = (value: unknown) => {
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new ProviderError("bank-incompatible")
    return hydrate(parsed.data)
  }
  return {
    catalog,
    schema,
    parse,
    parseText: (text: string) => {
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        throw new ProviderError("bank-incompatible")
      }
      return parse(value)
    },
  }
}
