import { createHash } from "node:crypto"
import { z } from "zod"
import { citationTable } from "./production-wire-lesson.ts"

const label = (en: string, ja: string) => ({ en, ja })

export function questions(prompt: string) {
  const ids = /analysisRevisionId=([^,]+), contextRevisionId=([^.]+)\. Citations:/.exec(prompt)
  const evidenceMatch = /Evidence: (\[[^\n]+\])\n\[/.exec(prompt)
  if (!ids) throw new TypeError("Question prompt has no exact lineage")
  const suffix = createHash("sha256").update(`${ids[1]}:${ids[2]}`).digest("hex").slice(0, 16)
  const citations = citationTable(prompt)
  const evidence = z
    .array(z.object({ sources: z.array(z.object({ reference: z.string() })) }))
    .parse(JSON.parse(evidenceMatch?.[1] ?? ""))
  const span = citations.get(evidence[0]?.sources[0]?.reference ?? "")
  if (!span) throw new TypeError("Question prompt has no book citation")
  return {
    analysisRevisionId: ids[1],
    contextRevisionId: ids[2],
    groups: [{ id: "focus", label: label("Focus", "焦点") }],
    lenses: [
      {
        id: `qa-lens-${suffix}`,
        revisionId: `qa-question-${suffix}`,
        groupId: "focus",
        learningGoalKey: "attention",
        label: label("Attention", "注意"),
        rationale: label("Consider the cited idea", "根拠を考える"),
        sources: [span],
        complications: [{ label: label("Limit", "限界"), sources: [span] }],
        prompt: label("Which angle will you study?", "どの視点を学びますか？"),
        mode: "single",
        minSelections: 1,
        maxSelections: 1,
        options: [
          {
            id: "notice",
            goalKey: "notice",
            label: label("Notice", "気づく"),
            rationale: label("Observe", "観察"),
          },
          {
            id: "ask",
            goalKey: "ask",
            label: label("Ask", "尋ねる"),
            rationale: label("Inquire", "質問"),
          },
        ],
      },
    ],
  }
}
