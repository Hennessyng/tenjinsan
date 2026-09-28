import { z } from "zod"

const label = (en: string, ja: string) => ({ en, ja })

export function citationTable(prompt: string): Map<string, unknown> {
  const match = /Citations: (\[.*?\]) Passages:/s.exec(prompt)
  if (!match) throw new TypeError("Provider prompt lacks citation table")
  const entries = z
    .array(z.object({ id: z.string(), span: z.unknown() }))
    .parse(JSON.parse(match[1] ?? ""))
  return new Map(entries.map((entry) => [entry.id, entry.span]))
}

export function lessonReply(prompt: string) {
  const fields = /outlineRevisionId=([^.]+)\. .* Outline: (\{.*\}) Evidence: (\[.*\])\n\[/s.exec(
    prompt,
  )
  if (!fields) throw new TypeError("Lesson prompt has no approved outline lineage")
  const outline = z
    .object({
      sections: z.array(
        z.object({
          id: z.string(),
          title: z.object({ en: z.string(), ja: z.string() }),
          sources: z.array(z.unknown()),
        }),
      ),
      qualifications: z.array(z.object({ id: z.string(), sources: z.array(z.unknown()) })),
    })
    .parse(JSON.parse(fields[2] ?? ""))
  const citations = citationTable(prompt)
  const evidence = z.array(z.object({ id: z.string() })).parse(JSON.parse(fields[3] ?? ""))
  return {
    outlineRevisionId: fields[1],
    sections: outline.sections.map((section, index) => {
      const span = citations.get(z.string().parse(section.sources[0] ?? evidence[0]?.id))
      if (!span) throw new TypeError("Lesson lacks approved evidence")
      const sceneId = `scene-${section.id}`
      return {
        id: section.id,
        title: section.title,
        content: label(
          "The selected source invites careful attention.",
          "選んだ資料を注意深く読みます。",
        ),
        attribution: { kind: "interpretation", sources: [span] },
        blocks: [
          {
            id: `block-${index}`,
            label: label("Source claim", "資料の主張"),
            content: label(
              "Read the cited passage before interpreting it.",
              "解釈する前に引用箇所を読みます。",
            ),
            attribution: { kind: "author-claim", sources: [span] },
            assumptions: [],
          },
        ],
        caveats:
          outline.qualifications.length > 0
            ? outline.qualifications.map((qualification) => ({
                id: qualification.id,
                text: label("Keep the source qualification.", "資料の留保を保ちます。"),
                sources: qualification.sources.map((id) => citations.get(z.string().parse(id))),
              }))
            : [
                {
                  id: `limit-${index}`,
                  text: label("This example is illustrative.", "この例は説明用です。"),
                  sources: [span],
                },
              ],
        scenes: [
          {
            id: sceneId,
            kind: "comparison",
            title: section.title,
            practice: [],
            variants: [
              {
                id: "source",
                label: label("Source", "資料"),
                explanation: label("What is cited", "引用された内容"),
              },
              {
                id: "reading",
                label: label("Reading", "読み方"),
                explanation: label("One interpretation", "一つの解釈"),
              },
            ],
          },
        ],
        sceneNotes: [
          {
            id: sceneId,
            attribution: { kind: "illustrative-model" },
            assumptions: [label("Illustrative, not measured", "測定ではなく説明用")],
          },
        ],
        practice: [
          {
            id: `practice-${index}`,
            prompt: label("Which claim needs checking?", "どの主張を確認しますか？"),
            options: [
              {
                id: "check",
                label: label("Check the source", "資料を確認"),
                feedback: label("Compare the passage", "本文と比べます"),
              },
              {
                id: "assume",
                label: label("Assume", "推測する"),
                feedback: label("Do not skip evidence", "根拠を省かない"),
              },
            ],
          },
        ],
      }
    }),
  }
}
