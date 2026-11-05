import { ChapterOutput, SynthesisOutput } from "@reading-studio/generation"
import { ProviderReceipt } from "@reading-studio/providers"

export function capacityOutputFrames(input: {
  readonly citation: {
    readonly resourcePath: string
    readonly blockId: string
    readonly start: number
    readonly end: number
  }
  readonly groupIds: readonly string[]
}) {
  const statement = { text: "\u0001".repeat(2000), citations: [input.citation] }
  const entries = Array.from({ length: 64 }, () => statement)
  const schemaChapter = ChapterOutput.parse({
    complete: true,
    claimStatus: "claims",
    purpose: statement,
    summary: statement,
    claims: entries,
    concepts: entries,
    definitions: entries,
    examples: entries,
    qualifications: entries,
    uncertainties: entries,
  })
  const schemaSynthesis = SynthesisOutput.parse({
    complete: true,
    representedGroupIds: input.groupIds,
    thesis: entries,
    progression: entries,
    connections: entries,
    conflicts: entries,
    changesOfPosition: entries,
    uncertainties: entries,
  })
  if (
    ChapterOutput.safeParse({ ...schemaChapter, claims: [...entries, statement] }).success ||
    SynthesisOutput.safeParse({ ...schemaSynthesis, thesis: [...entries, statement] }).success ||
    ChapterOutput.safeParse({ ...schemaChapter, summary: { ...statement, text: "x".repeat(2001) } })
      .success
  )
    throw new TypeError("Output schema bounds changed; witness must be re-derived")
  const chapter = ChapterOutput.parse({
    ...schemaChapter,
    claims: entries.slice(0, 8),
    concepts: [],
    definitions: [],
    examples: [],
    qualifications: [],
    uncertainties: [],
  })
  const synthesis = SynthesisOutput.parse({
    ...schemaSynthesis,
    thesis: [statement],
    progression: entries.slice(0, 9),
    connections: [],
    conflicts: [],
    changesOfPosition: [],
    uncertainties: [],
  })
  const chapterText = JSON.stringify(chapter),
    synthesisText = JSON.stringify(synthesis)
  ProviderReceipt.parse({ kind: "output", text: chapterText, usage: { kind: "unknown" } })
  ProviderReceipt.parse({ kind: "output", text: synthesisText, usage: { kind: "unknown" } })
  const maxItemTextBytes = Math.max(
    Buffer.byteLength(chapterText),
    Buffer.byteLength(synthesisText),
  )
  const maxRpcLineUnits = Math.max(
    ...[chapterText, synthesisText].map(
      (text) =>
        JSON.stringify({
          method: "item/completed",
          params: {
            threadId: "synthetic",
            turnId: "synthetic",
            item: { type: "agentMessage", phase: "final_answer", text },
          },
        }).length,
    ),
  )
  if (maxItemTextBytes > 128000 || maxRpcLineUnits > 1_000_000)
    throw new TypeError("Witness exceeds existing local transport guards")
  return {
    chapter,
    synthesis,
    statement,
    transport: {
      maxItemTextBytes,
      itemTextLimitBytes: 128000,
      maxRpcLineUnits,
      rpcLineLimitUnits: 1_000_000,
      usage: "unknown is admitted; not an output-token measurement",
    },
    schemaOnly: {
      mapReplyBytes: Buffer.byteLength(JSON.stringify(schemaChapter)),
      synthesisReplyBytes: Buffer.byteLength(JSON.stringify(schemaSynthesis)),
      admittedByTransport: false,
    },
  }
}
