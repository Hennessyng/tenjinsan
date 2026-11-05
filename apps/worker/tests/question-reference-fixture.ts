import { DiscoveryDraft } from "@reading-studio/generation/questions"
import type { Storage } from "@reading-studio/storage"
import { questionReferenceCatalog } from "../src/question-reference-catalog.ts"
import type { questionIdentityScope } from "./question-identity-scope.ts"

export function referenceDraft(
  storage: Storage,
  current: ReturnType<typeof questionIdentityScope>,
  rawDraft: unknown = current.draft,
) {
  const normalization = storage.sources.getNormalization(
    current.setup.analysis.normalizationRevisionId,
  )
  if (!normalization) throw new TypeError("Missing synthetic normalization")
  const catalog = questionReferenceCatalog({
    setup: current.setup,
    analysis: current.analysis,
    normalization,
    contextRevisionId: current.input.context.revisionId,
  })
  const draft = DiscoveryDraft.parse(rawDraft)
  return {
    version: "question-evidence-refs-v1",
    binding: catalog.binding,
    groups: draft.groups,
    lenses: draft.lenses.map(({ revisionId: _revisionId, sources, complications, ...lens }) => ({
      ...lens,
      evidenceRefs: sources.map(catalog.reference),
      complications: complications.map(({ label, sources: refs }) => ({
        label,
        evidenceRefs: refs.map(catalog.reference),
      })),
    })),
  }
}
