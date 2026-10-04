import { PublicationProjection } from "@reading-studio/contracts"

const pair = (en: string, ja: string) => ({ en, ja })
export const replyOptions = [
  {
    id: "ask",
    label: pair("Ask what matters most", "何が大切か尋ねる"),
    feedback: pair(
      "This opens space for the fictional speaker to clarify. It is not a guarantee of trust.",
      "架空の話し手が説明する余地を残します。信頼を保証するものではありません。",
    ),
  },
  {
    id: "advise",
    label: pair("Offer advice immediately", "すぐに助言する"),
    feedback: pair(
      "Advice introduces your solution before the fictional speaker has clarified their need.",
      "架空の話し手の望みを確かめる前に、自分の解決策を示す応答です。",
    ),
  },
  {
    id: "pause",
    label: pair("Leave a quiet pause", "静かに間を置く"),
    feedback: pair(
      "A pause makes room without requiring disclosure. Its meaning depends on context.",
      "沈黙は開示を求めずに余地を残します。その意味は文脈によって異なります。",
    ),
  },
] as const
export const practiceLesson = PublicationProjection.parse({
  title: pair("A little room to listen", "聞くための、少しの余白"),
  sections: [
    {
      id: "listening",
      heading: pair("Try a different reply", "別の応答を試す"),
      content: pair(
        "Synthetic teaching fixture. Compare ideas, not people.",
        "検証用の教材です。人ではなく、考え方を比較します。",
      ),
      scenes: [],
      practice: [
        {
          id: "reply",
          kind: "reply",
          prompt: pair("Which reply would you explore?", "どの応答を考えてみますか？"),
          scenario: pair(
            "Fictional scene: a colleague says, ‘I am unsure about this change.’",
            "架空の場面：同僚が「この変化には迷いがある」と言います。",
          ),
          options: replyOptions,
        },
        {
          id: "topic",
          kind: "topic",
          prompt: pair(
            "Which aspect of attention would you examine?",
            "注意のどの側面を考えてみますか？",
          ),
          options: [
            {
              id: "words",
              label: pair("Words and assumptions", "言葉と推測"),
              feedback: pair(
                "Separate the words you heard from the meaning you supplied.",
                "聞いた言葉と、自分で与えた意味を分けて考えます。",
              ),
            },
            {
              id: "limits",
              label: pair("Limits of curiosity", "好奇心の限界"),
              feedback: pair(
                "Curiosity does not create an obligation to disclose.",
                "好奇心があっても、相手には開示する義務はありません。",
              ),
            },
          ],
        },
        {
          id: "reflection",
          kind: "reflection",
          prompt: pair("What would you like to try privately?", "自分のために何を試したいですか？"),
          options: [
            {
              id: "listen",
              label: pair("Listen without planning a reply", "応答を考えずに聞く"),
              feedback: pair(
                "An optional experiment, not a measure of your character.",
                "任意の試みであり、人柄を測るものではありません。",
              ),
            },
            {
              id: "unsure",
              label: pair("Not sure yet / skip", "まだ分からない・見送る"),
              feedback: pair(
                "You can leave this open. No assessment is made.",
                "今は決めなくても構いません。評価はしません。",
              ),
            },
          ],
        },
      ],
      sourceNotes: [
        {
          id: "source",
          title: pair("Synthetic chapter one", "検証用の第一章"),
          locator: "chapter-1#listening",
          quotation: "A question can leave room for correction.",
          note: pair(
            "Original fixture text, not a published-book quotation.",
            "検証用の文であり、出版物からの引用ではありません。",
          ),
        },
      ],
    },
  ],
  bookMap: [
    { id: "one", title: pair("01 · Attention", "01・注意"), sectionIds: ["listening"] },
    { id: "two", title: pair("02 · Disagreement", "02・意見の違い"), sectionIds: [] },
    { id: "three", title: pair("03 · Repair", "03・関係の修復"), sectionIds: [] },
  ],
  assets: [],
})
