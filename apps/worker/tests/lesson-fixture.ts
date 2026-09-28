import { AnalysisCacheInput, analysisCacheKey } from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"

export function lessonFixture(storage: Storage, model = "fixture-model", sourceText?: string) {
  const graph = completeGraphFixtures()
  const text =
    sourceText ?? "Listening can reveal another perspective. It does not guarantee agreement."
  const span = {
    editionId: graph.edition.id,
    normalizationRevisionId: graph.normalization.id,
    resourcePath: "text/chapter.xhtml",
    blockId: "block-1",
    start: 0,
    end: text.length,
    originalFragment: text,
    pageLabel: "1",
  }
  storage.sources.createOwner("owner-1")
  storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
  storage.sources.appendEdition(graph.edition)
  storage.sources.createStudy({ id: "study-1", ownerId: "owner-1", editionId: graph.edition.id })
  storage.sources.appendNormalization({
    parentRevisionId: null,
    record: {
      ...graph.normalization,
      resources: [
        {
          path: span.resourcePath,
          role: "main-chapter",
          status: "included",
          blocks: [{ id: span.blockId, text, originalFragment: text, pageLabel: "1" }],
        },
      ],
    },
  })
  storage.sources.appendSetup({
    record: {
      ...graph.setup,
      analysis: { ...graph.setup.analysis, model },
    },
    parentRevisionId: null,
  })
  storage.workflow.appendAnalysis({
    parentRevisionId: null,
    record: {
      ...graph.analysis,
      cacheInput: { ...graph.analysis.cacheInput, model },
      cacheKey: analysisCacheKey(AnalysisCacheInput.parse({ ...graph.analysis.cacheInput, model })),
      claims: sourceText
        ? Array.from({ length: 8 }, (_, index) => ({
            id: `claim-${index + 1}`,
            text: "Listening reveals perspectives",
            sources: [{ ...span, start: index, originalFragment: text.slice(index) }],
          }))
        : [{ id: "claim-1", text: "Listening reveals perspectives", sources: [span] }],
      qualifications: [
        { id: "qualification-1", text: "Agreement is not guaranteed", sources: [span] },
      ],
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
  const title = { en: "What can listening change?", ja: "聴くことで何が変わるか？" }
  const brief = storage.briefs.save({
    studyId: "study-1",
    expectedRevisionId: null,
    content: {
      originalQuestion: title,
      refinedQuestion: null,
      questionChoice: "original",
      supportingQuestions: [],
      purpose: "Listen carefully",
      context: "A conversation",
      depth: "focused",
      language: "paired",
      spoilerPolicy: "avoid",
      exclusions: ["Diagnosis"],
    },
  })
  storage.briefs.decide({ studyId: "study-1", revisionId: brief.id, action: "approve" })
  const outline = storage.outlines.save({
    studyId: "study-1",
    briefRevisionId: brief.id,
    expectedRevisionId: null,
    feedback: null,
    content: {
      title,
      theme: title,
      sections: [
        {
          id: "section-1",
          title,
          theme: title,
          learningGoals: [title],
          visualIntents: [
            { en: "Compare hearing and inference", ja: "聞いたことと推測を比較する" },
          ],
          sources: [span],
          questionIndex: 0,
          visualKind: "illustrative-model",
          visualEvidence: [],
          flags: [],
        },
      ],
      qualifications: [
        { id: "qualification-1", text: "Agreement is not guaranteed", sources: [span] },
      ],
      excludedAreas: ["Diagnosis"],
    },
  })
  const assumptions = [
    { en: "Two fictional speakers; no measured quantities.", ja: "架空の二人。測定値は使わない。" },
  ]
  const draft = {
    outlineRevisionId: outline.id,
    sections: [
      {
        id: "section-1",
        title,
        content: {
          en: "Separate what you hear from what you infer.",
          ja: "聞いたことと推測したことを区別する。",
        },
        attribution: { kind: "interpretation", sources: [span] },
        blocks: [
          {
            id: "claim",
            label: { en: "Author claim", ja: "著者の主張" },
            content: {
              en: "Listening can reveal another perspective.",
              ja: "聴くことで別の視点が見えることがある。",
            },
            attribution: { kind: "author-claim", sources: [span] },
            assumptions: [],
          },
          {
            id: "reading",
            label: { en: "Interpretation", ja: "解釈" },
            content: {
              en: "Understanding need not mean agreement.",
              ja: "理解は必ずしも同意を意味しない。",
            },
            attribution: { kind: "interpretation", sources: [span] },
            assumptions: [],
          },
          {
            id: "example",
            label: { en: "Original example", ja: "独自の例" },
            content: {
              en: "Ask a colleague to clarify a concern.",
              ja: "同僚に懸念を詳しく説明してもらう。",
            },
            attribution: { kind: "original-example" },
            assumptions: [],
          },
          {
            id: "model",
            label: { en: "Illustrative model", ja: "説明用モデル" },
            content: {
              en: "Two panels separate hearing from inference.",
              ja: "二つの枠で聞いたことと推測を分ける。",
            },
            attribution: { kind: "illustrative-model" },
            assumptions,
          },
        ],
        caveats: [
          {
            id: "qualification-1",
            text: { en: "Agreement is not guaranteed.", ja: "同意が得られるとは限らない。" },
            sources: [span],
          },
        ],
        scenes: [
          {
            id: "scene-1",
            kind: "comparison",
            title,
            practice: [],
            variants: [
              {
                id: "heard",
                label: { en: "Heard", ja: "聞いたこと" },
                explanation: { en: "The speaker's words", ja: "話し手の言葉" },
              },
              {
                id: "inferred",
                label: { en: "Inferred", ja: "推測したこと" },
                explanation: { en: "Your provisional reading", ja: "自分の暫定的な解釈" },
              },
            ],
          },
        ],
        sceneNotes: [{ id: "scene-1", attribution: { kind: "illustrative-model" }, assumptions }],
        practice: [
          {
            id: "practice-1",
            prompt: { en: "What should you check?", ja: "何を確認すべきか？" },
            options: [
              {
                id: "ask",
                label: { en: "Ask for clarification", ja: "説明を求める" },
                feedback: {
                  en: "This tests your interpretation.",
                  ja: "自分の解釈を確かめられる。",
                },
              },
              {
                id: "assume",
                label: { en: "Assume agreement", ja: "同意したと決めつける" },
                feedback: {
                  en: "Listening does not guarantee agreement.",
                  ja: "聴いても同意が得られるとは限らない。",
                },
              },
            ],
          },
        ],
      },
    ],
  }
  return {
    outline,
    draft,
    span,
    text,
    request: { studyId: "study-1", outlineRevisionId: outline.id, lessonRevisionId: "lesson-19" },
  }
}
