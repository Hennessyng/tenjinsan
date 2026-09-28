import { generateFixtureLesson } from "@reading-studio/generation/lesson"
import type { Storage } from "@reading-studio/storage"

export function generateSyntheticLesson(storage: Storage, studyId: string): void {
  const current = storage.outlines.current(studyId)
  const outline = current && storage.outlines.approved(current.draft.id)
  if (!outline) return
  const lessonRevisionId = `synthetic-lesson-${outline.id}`
  if (storage.workflow.getLesson(lessonRevisionId)) return
  const assumptions = [
    {
      en: "Fictional speakers; no measured outcomes.",
      ja: "架空の話者。測定した結果ではありません。",
    },
  ]

  const draft = {
    outlineRevisionId: outline.id,
    sections: outline.sections.map((section) => {
      const sources = section.sources
      const attribution = { kind: "interpretation" as const, sources }
      const sceneId = `scene-${section.id}`
      return {
        id: section.id,
        title: section.title,
        content: {
          en: `Consider ${section.title.en} through evidence and interpretation.`,
          ja: `${section.title.ja}を根拠と解釈から考える。`,
        },
        attribution,
        blocks: [
          {
            id: "source",
            label: { en: "Source evidence", ja: "出典の根拠" },
            content: {
              en: "Return to the selected passage before interpreting it.",
              ja: "解釈の前に選んだ箇所に戻る。",
            },
            attribution: { kind: "author-claim" as const, sources },
            assumptions: [],
          },
          {
            id: "practice",
            label: { en: "Original example", ja: "独自の例" },
            content: {
              en: `Try asking a new question about ${section.title.en}.`,
              ja: `${section.title.ja}について新しい問いを立てる。`,
            },
            attribution: { kind: "original-example" as const },
            assumptions: [],
          },
        ],
        caveats: current.draft.content.qualifications.map((qualification) => ({
          id: qualification.id,
          text: { en: qualification.text, ja: "出典の限定も踏まえる。" },
          sources: qualification.sources,
        })),
        scenes: [
          {
            id: sceneId,
            kind: "comparison" as const,
            title: section.title,
            practice: [],
            variants: [
              {
                id: "observation",
                label: { en: "Observed", ja: "観察したこと" },
                explanation: { en: "Return to the passage.", ja: "出典の箇所に戻る。" },
              },
              {
                id: "inference",
                label: { en: "Inferred", ja: "推測したこと" },
                explanation: { en: "Hold an interpretation lightly.", ja: "解釈は暫定的に扱う。" },
              },
            ],
          },
        ],
        sceneNotes: [
          { id: sceneId, attribution: { kind: "illustrative-model" as const }, assumptions },
        ],
        practice: [
          {
            id: `practice-${section.id}`,
            prompt: { en: "What would you do next?", ja: "次に何をしますか？" },
            options: [
              {
                id: "ask",
                label: { en: "Ask first", ja: "まず尋ねる" },
                feedback: { en: "A question allows correction.", ja: "質問は訂正の余地を残す。" },
              },
              {
                id: "assume",
                label: { en: "Assume", ja: "決めつける" },
                feedback: { en: "An assumption is not evidence.", ja: "推測は根拠ではない。" },
              },
            ],
          },
        ],
      }
    }),
  }
  generateFixtureLesson(
    storage,
    { studyId, outlineRevisionId: outline.id, lessonRevisionId },
    draft,
  )
}
