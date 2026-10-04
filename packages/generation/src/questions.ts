import { contentDigest, Question } from "@reading-studio/contracts"
import { DiscoveryDraft, DiscoveryError, DiscoveryInput } from "./question-contracts.ts"

export { DiscoveryDraft, DiscoveryError, DiscoveryInput } from "./question-contracts.ts"

const normalized = (text: string) =>
  text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim()

export function generateQuestions(rawInput: unknown, fixtureOutput: unknown) {
  const input = DiscoveryInput.parse(rawInput)
  const draft = DiscoveryDraft.parse(fixtureOutput)
  if (
    draft.analysisRevisionId !== input.analysis.id ||
    draft.contextRevisionId !== input.context.revisionId
  )
    throw new DiscoveryError("revision-mismatch")
  const sourceKeys = new Set(
    [
      ...input.analysis.claims,
      ...input.analysis.concepts,
      ...input.analysis.qualifications,
    ].flatMap((finding) => finding.sources.map((source) => contentDigest(JSON.stringify(source)))),
  )
  for (const lens of draft.lenses) {
    const sources = [...lens.sources, ...lens.complications.flatMap((item) => item.sources)]
    if (sources.some((source) => !sourceKeys.has(contentDigest(JSON.stringify(source)))))
      throw new DiscoveryError("invalid-citation")
  }
  const seenGoals = new Set<string>()
  const seenLabels = new Set<string>()
  const removedLensIds: string[] = []
  const removedOptionIds: string[] = []
  const lenses = draft.lenses.flatMap((lens) => {
    const goal = normalized(lens.learningGoalKey)
    const labels = [normalized(lens.label.en), normalized(lens.label.ja)]
    if (seenGoals.has(goal) || labels.some((label) => seenLabels.has(label))) {
      removedLensIds.push(lens.id)
      return []
    }
    seenGoals.add(goal)
    for (const label of labels) seenLabels.add(label)
    const optionGoals = new Set<string>()
    const optionLabels = new Set<string>()
    const options = lens.options.filter((option) => {
      const key = normalized(option.goalKey)
      const labels = [normalized(option.label.en), normalized(option.label.ja)]
      if (optionGoals.has(key) || labels.some((label) => optionLabels.has(label))) {
        removedOptionIds.push(option.id)
        return false
      }
      optionGoals.add(key)
      for (const label of labels) optionLabels.add(label)
      return true
    })
    if (options.length < lens.maxSelections) throw new DiscoveryError("deduplicated-bounds")
    const question = Question.parse({
      id: lens.id,
      revisionId: lens.revisionId,
      analysisRevisionId: input.analysis.id,
      prompt: lens.prompt,
      mode: lens.mode,
      minSelections: lens.minSelections,
      maxSelections: lens.maxSelections,
      options: options.map(({ id, label }) => ({ id, label })),
      policy: { custom: true, unsure: true, skip: true },
      lens: { label: lens.label, sources: lens.sources },
    })
    return [Object.freeze({ ...lens, options: Object.freeze(options), question })]
  })
  const preferred = new Set(input.context.preferredGoalKeys.map(normalized))
  const shortlist = [...lenses]
    .sort(
      (a, b) =>
        Number(preferred.has(normalized(b.learningGoalKey))) -
        Number(preferred.has(normalized(a.learningGoalKey))),
    )
    .slice(0, 3)
    .map((lens) => lens.id)
  return Object.freeze({
    provider: "fixture" as const,
    analysisRevisionId: input.analysis.id,
    contextRevisionId: input.context.revisionId,
    studyId: input.context.studyId,
    customQuestion: input.context.customQuestion,
    groups: Object.freeze(
      draft.groups.filter((group) => lenses.some((lens) => lens.groupId === group.id)),
    ),
    lenses: Object.freeze(lenses),
    shortlist: Object.freeze(shortlist),
    review: Object.freeze({
      removedLensIds: Object.freeze(removedLensIds),
      removedOptionIds: Object.freeze(removedOptionIds),
    }),
  })
}
