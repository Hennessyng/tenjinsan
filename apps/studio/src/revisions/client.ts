import { Provider } from "@reading-studio/contracts/provider"
import { z } from "zod"

const Setup = z.object({
  id: z.string(),
  studyId: z.string(),
  editionId: z.string(),
  analysis: z.object({
    provider: Provider,
    model: z.string(),
    scope: z.object({
      kind: z.string(),
      selected: z.array(z.object({ resourcePath: z.string(), blockIds: z.array(z.string()) })),
      exclusions: z.array(z.object({ resourcePath: z.string() })),
    }),
  }),
})
export const RevisionState = z.object({
  reviewUrl: z.string().startsWith("/sources/").optional(),
  view: z.object({
    setup: Setup,
    history: z.array(Setup),
    parent: z.object({ studyId: z.string(), setupRevisionId: z.string() }).nullable(),
    analysis: z.object({ id: z.string() }).nullable(),
    grant: z.object({ kind: z.enum(["active", "revoked"]) }).nullable(),
  }),
  available: z.boolean(),
  canEdit: z.boolean(),
  choices: z.array(
    z.object({
      provider: z.enum(["anthropic", "openrouter", "codex"]),
      model: z.string(),
      label: z.string(),
    }),
  ),
})
export const ForkedRevision = z.object({ forkStudyId: z.string() })
export type Revision = z.infer<typeof RevisionState>
