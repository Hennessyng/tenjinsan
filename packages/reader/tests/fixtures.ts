import { PublicationProjection, SceneSpec } from "@reading-studio/contracts"

const pair = (en: string, ja: string) => ({ en, ja })
const practice = [
  {
    id: "reflect",
    prompt: pair("What could you ask next?", "次に何を尋ねられるでしょうか？"),
    options: [
      {
        id: "ask",
        label: pair("Ask before assuming", "決めつける前に尋ねる"),
        feedback: pair(
          "A question leaves room for correction.",
          "問いかけは、解釈を訂正する余地を残します。",
        ),
      },
      {
        id: "guess",
        label: pair("Guess their intention", "相手の意図を推測する"),
        feedback: pair(
          "A guess is a hypothesis, not evidence.",
          "推測は仮説であり、根拠ではありません。",
        ),
      },
    ],
  },
]
const item = {
  id: "notice",
  label: pair("Notice the difference", "相手の言葉と自分の解釈の違いに気づく"),
  explanation: pair(
    "Separate what was said from what you inferred.",
    "実際に語られたことと、自分が推測したことを分けて考えます。",
  ),
}
const base = { title: pair("A shift in attention", "注意の向け方を変える"), practice }
export const scenes = [
  SceneSpec.parse({ ...base, id: "layers", kind: "layered-diagram", layers: [item] }),
  SceneSpec.parse({ ...base, id: "compare", kind: "comparison", variants: [item] }),
  SceneSpec.parse({ ...base, id: "time", kind: "timeline", events: [item] }),
  SceneSpec.parse({ ...base, id: "process", kind: "annotated-process", steps: [item], loop: true }),
  SceneSpec.parse({ ...base, id: "perspective", kind: "perspective-3d", viewpoints: [item] }),
  SceneSpec.parse({
    ...base,
    id: "spatial",
    kind: "spatial-layers-3d",
    layers: [item],
    viewpoints: [item],
  }),
]
export const lessons = [
  PublicationProjection.parse({
    title: pair("The space before an answer", "答える前の、ひと呼吸"),
    sections: [
      {
        id: "attention",
        heading: pair("Attention is a choice", "注意を向けるという選択"),
        content: pair(
          "Listening begins before we decide what to say.\n\nLeave room for the other person to surprise you.",
          "聞くことは、何を言うかを決める前に始まります。\n\n相手の言葉に驚く余地を残しましょう。",
        ),
        scenes: scenes.slice(0, 2),
        practice,
        sourceNotes: [
          {
            id: "note",
            title: pair("Synthetic reading notes", "検証用の読書ノート"),
            locator: "chapter-1#attention:0-42",
            quotation: "Listening leaves room for a different answer.",
            note: pair(
              "An original example, not a quotation from a published book.",
              "これは独自の例であり、出版された本からの引用ではありません。",
            ),
          },
        ],
      },
      {
        id: "return",
        heading: pair("Return to the question", "問いに立ち戻る"),
        content: pair(
          "Try a question that can change your interpretation.",
          "自分の解釈を変えられる問いを試してみましょう。",
        ),
        scenes: [],
        practice: [],
        sourceNotes: [],
      },
    ],
    assets: [],
  }),
  PublicationProjection.parse({
    title: pair("Changing perspectives", "異なる視点から考え直す"),
    sections: [
      {
        id: "stress",
        heading: pair(
          "A careful second look",
          "相手の言葉を急いで結論に結びつけずに異なる視点から丁寧に考え直すための手がかり",
        ),
        content: pair(
          '<script>alert("reader")</script> <img src=x onerror=alert(1)>',
          "長い文章も省略せずに表示します。読み手が自分のペースで意味を確かめられるよう、説明は常に本文に残します。",
        ),
        scenes: scenes.slice(2),
        practice,
        sourceNotes: [
          {
            id: "note",
            title: pair("Literal source text", "原文の文字列"),
            locator: "javascript:alert(1)",
            quotation: "<svg onload=alert(1)>",
            note: pair(
              "Markup is text, never an executable instruction.",
              "マークアップは文字として扱い、実行しません。",
            ),
          },
        ],
      },
    ],
    assets: [],
  }),
] as const
