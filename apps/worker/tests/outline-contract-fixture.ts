import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  AnalysisCacheInput,
  AnalysisRevision,
  analysisCacheKey,
  type Bilingual,
  BriefContent,
  Job,
  OutlineContent,
  Question,
} from "@reading-studio/contracts"
import { fixtureOutlineProvider } from "@reading-studio/generation/outline"
import { generationStage } from "@reading-studio/generation/provider-stages"
import { openStorage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"

export function outlineContractFixture(supportingQuestions: readonly Bilingual[] = []) {
  const directory = mkdtempSync(join(tmpdir(), "outline-contract-"))
  const storage = openStorage({
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  })
  const graph = completeGraphFixtures("openrouter")
  const analysis = AnalysisRevision.parse({
    ...graph.analysis,
    cacheKey: analysisCacheKey(AnalysisCacheInput.parse(graph.analysis.cacheInput)),
    qualifications: graph.analysis.claims.map((claim) => ({
      ...claim,
      id: `qualification-${claim.id}`,
      text: "Only the synthetic selected evidence supports this illustration.",
    })),
  })
  storage.sources.createOwner("owner-1")
  storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
  storage.sources.persistDocument({ edition: graph.edition, normalization: graph.normalization })
  storage.sources.createStudy({
    id: graph.setup.studyId,
    ownerId: "owner-1",
    editionId: graph.edition.id,
  })
  storage.sources.appendSetup({ record: graph.setup, parentRevisionId: null })
  storage.sources.appendGrant(graph.grant)
  storage.workflow.appendAnalysis({ record: analysis, parentRevisionId: null })
  const questions = [0, 1, 2].map((index) =>
    Question.parse({
      ...graph.question,
      id: `preference-${index}`,
      revisionId: `preference-revision-${index}`,
    }),
  )
  const interview = storage.interviews.create({
    id: "interview-1",
    studyId: graph.setup.studyId,
    analysisRevisionId: analysis.id,
    contextRevisionId: "context-1",
    groups: [{ id: "focus", label: { en: "Focus", ja: "焦点" } }],
    shortlist: questions.map((question) => question.id),
    steps: questions.map((question) => ({ groupId: "focus", purpose: "preference", question })),
  })
  for (const question of questions) {
    const option = question.options[0]
    if (!option) throw new TypeError("Synthetic choice missing")
    storage.interviews.save({
      studyId: graph.setup.studyId,
      interviewId: interview.id,
      answer: {
        kind: "choice",
        questionId: question.id,
        questionRevisionId: question.revisionId,
        optionIds: [option.id],
      },
    })
  }
  const content = BriefContent.parse({
    originalQuestion: {
      en: "How does the synthetic example work?",
      ja: "合成例はどのように機能しますか？",
    },
    refinedQuestion: null,
    questionChoice: "original",
    supportingQuestions,
    purpose: "Synthetic contract test",
    context: "Synthetic reader preferences",
    depth: "overview",
    language: "paired",
    spoilerPolicy: "allow",
    exclusions: ["RETAINED_EXCLUSION_SENTINEL"],
  })
  const draft = storage.briefs.save({
    studyId: graph.setup.studyId,
    expectedRevisionId: null,
    content,
  })
  storage.briefs.decide({ studyId: graph.setup.studyId, revisionId: draft.id, action: "approve" })
  const brief = storage.briefs.approved(draft.id)
  if (!brief) throw new TypeError("Synthetic approved brief missing")
  const initial = fixtureOutlineProvider({ brief, analysis, previous: null, feedback: null })
  const section = initial.sections[0]
  if (!section) throw new TypeError("Synthetic outline section missing")
  const good = OutlineContent.parse({
    ...initial,
    sections: [0, 1, 2].map((index) => ({ ...section, id: `section-${index}`, questionIndex: 0 })),
  })
  const job = Job.parse({
    ...graph.job,
    id: "outline-contract-fixture",
    runId: "outline-contract-run",
    inputRevisionId: brief.id,
    stage: "outline",
  })
  const stage = generationStage(storage, job)
  return {
    storage,
    brief,
    analysis,
    good,
    stage,
    job,
    close: () => {
      storage.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
