import { z } from "zod"

export const EvidenceState = z.object({
  view: z.object({
    draft: z.object({
      id: z.string(),
      studyId: z.string(),
      lessonRevisionId: z.string(),
      projectionHash: z.string(),
      keepPrivate: z.boolean(),
      semantic: z.array(
        z.object({
          category: z.enum(["support", "qualification", "translation", "visual"]),
          status: z.string(),
        }),
      ),
    }),
    mechanical: z.array(z.object({ category: z.string(), path: z.string() })),
    privacy: z.object({
      id: z.string(),
      status: z.string(),
      reviewedPaths: z.array(z.string()),
      findings: z.array(z.object({ category: z.string(), path: z.string() })),
    }),
    ready: z.boolean(),
    reportHash: z.string(),
  }),
  references: z.array(z.object({ title: z.string(), href: z.string(), text: z.string() })),
  entries: z.array(z.object({ path: z.string(), text: z.string() })),
  removable: z.array(z.string()),
})
export const LatestLesson = z.object({ lessonId: z.string() })
export type Evidence = z.infer<typeof EvidenceState>
export type EvidenceAction =
  | {
      readonly action: "semantic"
      readonly category: "support" | "qualification" | "translation" | "visual"
      readonly status: "reviewed" | "acknowledged"
    }
  | {
      readonly action: "replace-text" | "private-detail"
      readonly text: string
      readonly path?: string
    }
  | { readonly action: "privacy-flag" | "remove-content"; readonly path: string }
  | { readonly action: "privacy-reviewed" | "keep-private" }
