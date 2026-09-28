import { AnalysisCacheInput, analysisCacheKey } from "@reading-studio/contracts"
import type { Storage } from "../src/index.ts"
import { completeGraphFixtures } from "./fixtures.ts"

export const approvalGraph = completeGraphFixtures()
export const approvalContent = {
  originalQuestion: { en: "What matters?", ja: "何が大切ですか？" },
  refinedQuestion: { en: "What matters when listening?", ja: "聴くとき何が大切ですか？" },
  questionChoice: "original",
  supportingQuestions: [{ en: "What gets in the way?", ja: "何が妨げになりますか？" }],
  purpose: "Practice listening",
  context: "A private conversation",
  depth: "deep",
  language: "paired",
  spoilerPolicy: "avoid",
  exclusions: ["Diagnosis"],
}

export function seedApprovalStorage(storage: Storage) {
  const graph = approvalGraph
  storage.sources.createOwner("owner-1")
  storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
  storage.sources.appendEdition(graph.edition)
  storage.sources.createStudy({ id: "study-1", ownerId: "owner-1", editionId: graph.edition.id })
  storage.sources.appendNormalization({ record: graph.normalization, parentRevisionId: null })
  storage.sources.appendSetup({ record: graph.setup, parentRevisionId: null })
  storage.sources.appendGrant(graph.grant)
  storage.workflow.appendAnalysis({
    parentRevisionId: null,
    record: {
      ...graph.analysis,
      cacheKey: analysisCacheKey(AnalysisCacheInput.parse(graph.analysis.cacheInput)),
    },
  })
  storage.interviews.create({
    id: "interview-1",
    studyId: "study-1",
    analysisRevisionId: "analysis-1",
    contextRevisionId: "context-1",
    groups: [{ id: "group-1", label: { en: "Focus", ja: "視点" } }],
    steps: [{ groupId: "group-1", purpose: "preference", question: graph.question }],
    shortlist: [graph.question.id],
  })
}
