import { LessonRevision } from "@reading-studio/contracts"
import { fixtureOutlineProvider } from "@reading-studio/generation/outline"
import { interviewFixture } from "./interview-fixture.ts"

export async function evidenceFixture() {
  const fixture = await interviewFixture()
  const { storage } = fixture
  const initialAnalysis = storage.workflow.getAnalysis(fixture.definition.analysisRevisionId)
  if (!initialAnalysis) throw new TypeError("Missing fixture analysis")
  storage.sources.appendSetup({
    parentRevisionId: null,
    record: {
      id: "setup-evidence",
      studyId: fixture.definition.studyId,
      editionId: initialAnalysis.editionId,
      analysis: initialAnalysis.cacheInput,
      generation: {
        promptVersion: "generation-1",
        schemaVersion: "generation-1",
        settings: initialAnalysis.cacheInput.settings,
      },
    },
  })
  const brief = storage.briefs.save({
    studyId: "study-fixture",
    expectedRevisionId: null,
    content: {
      originalQuestion: { en: "How can attention help?", ja: "注意はどう役立つか？" },
      refinedQuestion: null,
      questionChoice: "original",
      supportingQuestions: [],
      purpose: "Practice attention",
      context: "Mira Canarystone",
      depth: "focused",
      language: "paired",
      spoilerPolicy: "avoid",
      exclusions: [],
    },
  })
  storage.briefs.decide({ studyId: brief.studyId, revisionId: brief.id, action: "approve" })
  const approved = storage.briefs.approved(brief.id)
  const analysis = storage.workflow.getAnalysis(fixture.definition.analysisRevisionId)
  if (!approved || !analysis) throw new TypeError("Missing fixture lineage")
  const outline = storage.outlines.save({
    studyId: brief.studyId,
    briefRevisionId: brief.id,
    expectedRevisionId: null,
    feedback: null,
    content: fixtureOutlineProvider({ brief: approved, analysis, previous: null, feedback: null }),
  })
  storage.outlines.decide({ studyId: brief.studyId, revisionId: outline.id, action: "approve" })
  const lesson = LessonRevision.parse({
    id: "lesson-evidence",
    studyId: brief.studyId,
    briefRevisionId: brief.id,
    outlineRevisionId: outline.id,
    setupRevisionId: approved.setupRevisionId,
    analysisRevisionId: approved.analysisRevisionId,
    coverage: {
      kind: "partial",
      sources: analysis.claims.flatMap((claim) => claim.sources),
      limitations: [],
    },
    sections: outline.content.sections.map((section) => ({
      id: section.id,
      title: section.title,
      content: { en: "Ask Mira Canarystone what they heard.", ja: "何を聞いたか相手に尋ねる。" },
      attribution: { kind: "interpretation", sources: section.sources },
      reviewerFlags: [],
      scenes: [
        {
          id: `scene-${section.id}`,
          kind: "comparison",
          title: section.title,
          practice: [],
          captions: [
            {
              stateId: `scene-${section.id}:variant:heard`,
              text: { en: "Words, not assumptions", ja: "仮定ではなく言葉" },
            },
          ],
          variants: [
            {
              id: "heard",
              label: { en: "Heard", ja: "聞いたこと" },
              explanation: { en: "Words, not assumptions", ja: "仮定ではなく言葉" },
            },
          ],
        },
      ],
      practice: [
        {
          id: "practice",
          prompt: { en: "What next?", ja: "次は？" },
          options: [
            {
              id: "ask",
              label: { en: "Ask", ja: "尋ねる" },
              feedback: { en: "Check your interpretation.", ja: "解釈を確かめる。" },
            },
          ],
        },
      ],
    })),
  })
  storage.workflow.appendLesson({ parentRevisionId: null, record: lesson })
  return { ...fixture, lesson, path: `/evidence/${lesson.studyId}/${lesson.id}` }
}
