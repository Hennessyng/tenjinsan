import { PublicationProjection, requiredTeachingStates, SceneSpec } from "@reading-studio/contracts"

const stages = [
  {
    id: "notice",
    label: { en: "Notice", ja: "気づく" },
    explanation: {
      en: "Observe what was actually said.",
      ja: "実際に語られたことに目を向けます。",
    },
  },
  {
    id: "ask",
    label: { en: "Ask", ja: "尋ねる" },
    explanation: {
      en: "Ask a question before drawing a conclusion.",
      ja: "結論を出す前に問いかけます。",
    },
  },
  {
    id: "revise",
    label: { en: "Reconsider", ja: "考え直す" },
    explanation: {
      en: "Revise your interpretation in light of the answer.",
      ja: "答えを受けて、自分の解釈を考え直します。",
    },
  },
]
const base = { practice: [] }
const scenes = [
  SceneSpec.parse({
    ...base,
    id: "layers",
    title: { en: "Layers of interpretation", ja: "解釈の層" },
    kind: "layered-diagram",
    layers: stages,
  }),
  SceneSpec.parse({
    ...base,
    id: "compare",
    title: { en: "Three ways to respond", ja: "三つの応じ方" },
    kind: "comparison",
    variants: stages,
  }),
  SceneSpec.parse({
    ...base,
    id: "time",
    title: { en: "Before the answer", ja: "答えるまでの流れ" },
    kind: "timeline",
    events: stages,
  }),
  SceneSpec.parse({
    ...base,
    id: "process",
    title: { en: "A careful conversation", ja: "丁寧な対話" },
    kind: "annotated-process",
    steps: stages,
    loop: false,
  }),
  SceneSpec.parse({
    ...base,
    id: "loop",
    title: { en: "Return with a better question", ja: "問いを深めて立ち戻る" },
    kind: "annotated-process",
    steps: stages,
    loop: true,
  }),
]
export const sceneLesson = PublicationProjection.parse({
  title: { en: "A question changes the picture", ja: "問いが見方を変える" },
  sections: [
    {
      id: "scene-showcase",
      heading: { en: "Five ways to explain a change", ja: "変化を伝える五つの図解" },
      content: {
        en: "Explore each model at your own pace. Every explanation remains below the diagram.",
        ja: "それぞれのモデルを自分のペースで確かめましょう。すべての解説は図の下に残ります。",
      },
      scenes: scenes.map((scene) => ({
        ...scene,
        captions: requiredTeachingStates(scene).map((state) => ({
          stateId: state.id,
          text: state.explanation,
        })),
      })),
      practice: [],
      sourceNotes: [],
    },
  ],
  assets: [],
})
