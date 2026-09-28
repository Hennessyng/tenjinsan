import { InputRevisionId, Question, StudyId } from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { interviewFromDiscovery } from "./discovery.ts"
import { interviewPage } from "./page.ts"

it("keeps the contextual shortlist order and optional bank when adapting discovery", async () => {
  // Given
  const questions = ["first", "preferred", "optional"].map((id) =>
    Question.parse({
      id,
      revisionId: `${id}-v1`,
      analysisRevisionId: "analysis-1",
      mode: "single",
      minSelections: 1,
      maxSelections: 1,
      prompt: { en: id, ja: id },
      options: [{ id: `${id}-choice`, label: { en: id, ja: id } }],
      policy: { custom: true, unsure: true, skip: true },
    }),
  )
  const first = questions[0]
  const preferred = questions[1]
  if (!first || !preferred) throw new TypeError("Missing questions")
  const bank = {
    studyId: StudyId.parse("study-1"),
    analysisRevisionId: first.analysisRevisionId,
    contextRevisionId: InputRevisionId.parse("context-1"),
    groups: [{ id: "group", label: { en: "Group", ja: "分類" } }],
    lenses: questions.map((question) => ({ groupId: "group", question })),
    shortlist: [preferred.id, first.id],
  }
  // When
  const definition = interviewFromDiscovery({ id: InputRevisionId.parse("interview-1"), bank })
  // Then
  expect(definition.shortlist).toEqual(["preferred", "first"])
  expect(definition.steps.map((step) => step.question)).toEqual(questions)
  const page = String(
    await interviewPage({
      definition,
      answers: [],
      stepId: undefined,
      language: "en",
      state: "view",
    }),
  )
  expect(page).toContain('value="preferred-v1"')
  expect(page).toContain("step=optional")
})
