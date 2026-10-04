import { z } from "zod"

const Pair = z.object({ en: z.string(), ja: z.string() })
const Source = z.object({
  resourcePath: z.string(),
  blockId: z.string(),
  start: z.number(),
  end: z.number(),
})
export const OutlineState = z.object({
  view: z
    .object({
      status: z.enum(["pending", "approved", "revise", "defer", "outdated"]),
      draft: z.object({
        id: z.string(),
        feedback: z
          .discriminatedUnion("kind", [
            z.object({ kind: z.literal("choice"), value: z.string() }),
            z.object({ kind: z.literal("custom"), text: z.string() }),
          ])
          .nullable(),
        content: z.object({
          title: Pair,
          theme: Pair,
          sections: z.array(
            z.object({
              id: z.string(),
              title: Pair,
              questionIndex: z.number(),
              learningGoals: z.array(Pair),
              sources: z.array(Source),
              visualKind: z.enum(["illustrative-model", "source-grounded"]),
              visualIntents: z.array(Pair),
              flags: z.array(z.string()),
            }),
          ),
          qualifications: z.array(z.object({ text: z.string(), sources: z.array(Source) })),
          excludedAreas: z.array(z.string()),
        }),
      }),
    })
    .nullable(),
  brief: z
    .object({ id: z.string(), guidingQuestion: Pair, supportingQuestions: z.array(Pair) })
    .nullable(),
  scope: z
    .object({
      exclusions: z.array(z.object({ resourcePath: z.string(), blockIds: z.array(z.string()) })),
    })
    .nullable(),
  fixture: z.boolean(),
  providerReady: z.boolean(),
})
export type Outline = z.infer<typeof OutlineState>

export const OutlineAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate"),
    briefRevisionId: z.string(),
    expectedRevisionId: z.string(),
  }),
  z.object({ action: z.enum(["approve", "revise", "defer"]), revisionId: z.string() }),
  z.object({
    action: z.literal("choice"),
    revisionId: z.string(),
    value: z.enum(["reverse-order", "simplify-visuals"]),
  }),
  z.object({
    action: z.literal("custom"),
    revisionId: z.string(),
    text: z.string().trim().min(1).max(2000),
  }),
])
