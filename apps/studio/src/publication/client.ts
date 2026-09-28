import { z } from "zod"

const Pair = z.object({ en: z.string(), ja: z.string() })
export const PublicationState = z.object({
  view: z
    .object({
      draft: z.object({
        id: z.string(),
        studyId: z.string(),
        lessonRevisionId: z.string(),
        projectionHash: z.string(),
        keepPrivate: z.boolean(),
        projection: z.object({
          title: Pair,
          sections: z.array(z.object({ id: z.string(), heading: Pair, content: Pair })),
        }),
      }),
      reportHash: z.string(),
      ready: z.boolean(),
      privacy: z.object({ id: z.string() }),
    })
    .nullable(),
  entries: z.array(z.object({ path: z.string(), text: z.string() })),
  history: z.array(
    z.object({
      snapshot: z.object({
        publication: z.object({
          id: z.string(),
          approval: z.object({ rendererVersion: z.string(), approvedAt: z.string() }),
        }),
        evidence: z.object({ draft: z.object({ studyId: z.string() }) }),
      }),
      current: z.boolean(),
      outputs: z.array(
        z.object({
          id: z.string(),
          format: z.enum(["html", "pdf"]),
          state: z.string(),
          error: z.string().nullable().optional(),
        }),
      ),
    }),
  ),
})
export const RevisionRedirect = z.object({ redirect: z.string() })
export const Generated = z.object({ generated: z.literal(true) })
export type Publication = z.infer<typeof PublicationState>
