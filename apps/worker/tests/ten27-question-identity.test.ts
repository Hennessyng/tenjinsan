import { StudySetupRevision } from "@reading-studio/contracts"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { persistedQuestionIdentity } from "../src/persisted-question-identity.ts"

it("scopes persisted identities to study, setup, analysis, context and slot", () => {
  // Given
  const setup = StudySetupRevision.parse(completeGraphFixtures("openrouter").setup)
  const input = {
    setup,
    analysisRevisionId: "analysis-a",
    contextRevisionId: "context-a",
    position: 0,
  }
  const original = persistedQuestionIdentity(input)
  // When
  const alternatives = [
    persistedQuestionIdentity({
      ...input,
      setup: StudySetupRevision.parse({ ...setup, studyId: "other-study" }),
    }),
    persistedQuestionIdentity({
      ...input,
      setup: StudySetupRevision.parse({ ...setup, id: "other-setup" }),
    }),
    persistedQuestionIdentity({ ...input, analysisRevisionId: "other-analysis" }),
    persistedQuestionIdentity({ ...input, contextRevisionId: "other-context" }),
    persistedQuestionIdentity({ ...input, position: 1 }),
  ]
  // Then
  expect(persistedQuestionIdentity(input)).toEqual(original)
  expect(new Set([original, ...alternatives].map((identity) => identity.id)).size).toBe(6)
  expect(new Set([original, ...alternatives].map((identity) => identity.revisionId)).size).toBe(6)
})
