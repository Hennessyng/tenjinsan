import { analysisCacheKey, type Job } from "@reading-studio/contracts"
import { DiscoveryDraft } from "@reading-studio/generation/questions"
import type { ManagedWorkflow } from "./managed-workflow-fixture.ts"

export function managedQuestionOutput(flow: ManagedWorkflow, job: Job, lenses = 1) {
  const setup = flow.storage.sources.getSetup(job.setupRevisionId)
  const analysis =
    setup &&
    flow.storage.workflow.findSuccessfulAnalysis(analysisCacheKey(setup.analysis), {
      setupId: setup.id,
      grantId: job.grant.id,
    })
  const normalization =
    setup && flow.storage.sources.getNormalization(setup.analysis.normalizationRevisionId)
  const source = analysis?.claims[0]?.sources[0]
  if (!setup || !analysis || !normalization || !source)
    throw new TypeError("Missing managed question context")
  const pair = (en: string) => ({ en, ja: `合成 ${en}` })
  const draft = DiscoveryDraft.parse({
    analysisRevisionId: analysis.id,
    contextRevisionId: job.inputRevisionId,
    groups: [{ id: "focus", label: pair("Focus") }],
    lenses: Array.from({ length: lenses }, (_, index) => ({
      id: `lens-${index}`,
      revisionId: `revision-${index}`,
      groupId: "focus",
      learningGoalKey: `goal-${index}`,
      label: pair(`Lens ${index}`),
      rationale: pair(`Reason ${index}`),
      sources: [source],
      complications: [{ label: pair(`Limit ${index}`), sources: [source] }],
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
  })
  const wire = draft
  return { draft, wire, source }
}
