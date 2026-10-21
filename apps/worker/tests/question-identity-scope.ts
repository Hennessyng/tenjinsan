import { AnalysisRevision, analysisCacheKey } from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"
import type { completeGraphFixtures } from "@reading-studio/storage/test-support"

export function questionIdentityScope(args: {
  readonly storage: Storage
  readonly graph: ReturnType<typeof completeGraphFixtures>
  readonly name: string
  readonly shared: boolean
}) {
  const { storage, graph, name, shared } = args
  storage.sources.createStudy({
    id: `study-${name}`,
    ownerId: "owner-1",
    editionId: graph.edition.id,
  })
  const setup = storage.sources.appendSetup({
    record: {
      ...graph.setup,
      id: `setup-${name}`,
      studyId: `study-${name}`,
      analysis: {
        ...graph.setup.analysis,
        model: "openai/gpt-4.1-mini",
        settings: {
          ...graph.setup.analysis.settings,
          maxOutputTokens: shared || name === "prior" ? 1000 : 999,
        },
      },
    },
    parentRevisionId: null,
  })
  const grant = storage.sources.appendGrant({
    ...graph.grant,
    id: `grant-${name}`,
    setupRevisionId: setup.id,
    categories: ["book-text", "derived-study-material", "reader-context"],
  })
  const key = analysisCacheKey(setup.analysis)
  const analysis =
    storage.workflow.findSuccessfulAnalysis(key) ??
    storage.workflow.appendAnalysis({
      record: AnalysisRevision.parse({
        ...graph.analysis,
        id: `analysis-${name}`,
        cacheInput: setup.analysis,
        cacheKey: key,
      }),
      parentRevisionId: null,
    })
  const inputRevisionId = storage.workflow.ensureAnalysisInput(setup.id)
  const span = analysis.claims[0]?.sources[0]
  if (!span) throw new TypeError("Synthetic source missing")
  const pair = (en: string) => ({ en, ja: `合成 ${en}` })
  const draft = {
    analysisRevisionId: analysis.id,
    contextRevisionId: inputRevisionId,
    groups: [{ id: "focus", label: pair("Focus") }],
    lenses: [0, 1, 2].slice(0, name === "prior" ? 3 : 2).map((index) => ({
      id: `lens-${index}`,
      revisionId: `revision-${index}`,
      groupId: "focus",
      learningGoalKey: `goal-${index}`,
      label: pair(`Lens ${index}`),
      rationale: pair(`Reason ${index}`),
      sources: [span],
      complications: [{ label: pair(`Limit ${index}`), sources: [span] }],
      prompt: pair(`Choice ${index}`),
      mode: "single",
      minSelections: 1,
      maxSelections: 1,
      options: [0, 1].map((option) => ({
        id: `option-${index}-${option}`,
        goalKey: `option-${option}`,
        label: pair(`Option ${option}`),
        rationale: pair(`Reason ${option}`),
      })),
    })),
  }
  const input = {
    analysis,
    context: {
      revisionId: inputRevisionId,
      studyId: setup.studyId,
      preferredGoalKeys: [],
      customQuestion: null,
    },
    expected: {
      analysisRevisionId: analysis.id,
      contextRevisionId: inputRevisionId,
      studyId: setup.studyId,
    },
  }
  return { setup, grant, analysis, input, draft }
}
