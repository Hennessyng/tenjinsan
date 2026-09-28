import { once } from "node:events"
import { createServer, type ServerResponse } from "node:http"
import { z } from "zod"
import { citationTable, lessonReply } from "./production-wire-lesson.ts"
import { questions } from "./production-wire-questions.ts"

const label = (en: string, ja: string) => ({ en, ja })

function outlineReply(prompt: string): unknown {
  const fields = /Brief: (\{.*\}) Evidence: (\[.*\])\n\[/s.exec(prompt)
  if (!fields) throw new TypeError("Outline prompt has no approved brief and evidence")
  const brief = z
    .object({
      guidingQuestion: z.object({ en: z.string(), ja: z.string() }),
      supportingQuestions: z.array(z.object({ en: z.string(), ja: z.string() })),
      exclusions: z.array(z.string()),
      purpose: z.string(),
    })
    .parse(JSON.parse(fields[1] ?? ""))
  const evidence = z
    .array(z.object({ sources: z.array(z.unknown()).min(1) }))
    .parse(JSON.parse(fields[2] ?? ""))
  const citations = citationTable(prompt)
  const sources = evidence.flatMap((finding) =>
    finding.sources.map((id) => citations.get(z.string().parse(id))),
  )
  const revisionMatch = /Revision: (\{.*\})\. Citations:/s.exec(prompt)
  const revision = revisionMatch
    ? z
        .object({
          previous: z.object({
            sections: z.array(
              z.object({
                id: z.string(),
                title: z.object({ en: z.string(), ja: z.string() }),
                theme: z.object({ en: z.string(), ja: z.string() }),
                questionIndex: z.number(),
                learningGoals: z.array(z.object({ en: z.string(), ja: z.string() })),
                sources: z.array(z.unknown()),
                visualIntents: z.array(z.object({ en: z.string(), ja: z.string() })),
                visualKind: z.string(),
                visualEvidence: z.array(z.unknown()),
                flags: z.array(z.string()),
              }),
            ),
          }),
          feedback: z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("choice"), value: z.string() }),
            z.object({ kind: z.literal("custom"), text: z.string() }),
          ]),
        })
        .parse(JSON.parse(revisionMatch[1] ?? ""))
    : null
  const sections = revision
    ? revision.previous.sections.map((section) => ({
        ...section,
        visualIntents: [
          revision.feedback.kind === "custom"
            ? label(revision.feedback.text, revision.feedback.text)
            : label("Simpler source panel", "簡潔な資料図"),
        ],
        visualKind: "illustrative-model",
      }))
    : [brief.guidingQuestion, ...brief.supportingQuestions].map((question, index) => ({
        id: `section-${index + 1}`,
        title: question,
        theme: brief.guidingQuestion,
        questionIndex: index,
        learningGoals: [question],
        sources,
        visualIntents: [label("Compare source and limitation", "根拠と限界を比較する")],
        visualKind: "illustrative-model",
        visualEvidence: [],
        flags: [],
      }))
  return {
    title: brief.guidingQuestion,
    theme: label(`Study ${brief.purpose}`, "問いと根拠を学ぶ"),
    sections,
    qualifications: [],
    excludedAreas: brief.exclusions,
  }
}

export type WireFault =
  | "normal"
  | "malformed-output"
  | "invalid-citation"
  | "hold"
  | "privacy-canary"

function reply(prompt: string, fault: WireFault, provider: "openai" | "anthropic"): unknown {
  if (prompt.startsWith("Analyze only this source window"))
    return {
      claims: [
        {
          text:
            provider === "anthropic"
              ? "Anthropic synthetic fixture finding"
              : "Synthetic fixture source finding",
          start: 0,
          end: 1,
        },
      ],
      concepts: [],
      qualifications: [],
    }
  if (prompt.startsWith("Create distinct book-grounded bilingual choice lenses")) {
    const draft = questions(prompt)
    if (fault !== "invalid-citation") return draft
    const forged = {
      ...z.record(z.string(), z.unknown()).parse(draft.lenses[0]?.sources[0]),
      blockId: "forged-block",
    }
    return {
      ...draft,
      lenses: draft.lenses.map((lens) => ({
        ...lens,
        sources: [forged],
        complications: lens.complications.map((item) => ({ ...item, sources: [forged] })),
      })),
    }
  }
  if (prompt.startsWith("Write a bilingual teaching outline")) return outlineReply(prompt)
  if (prompt.startsWith("Write a paired English/Japanese lesson")) {
    const draft = lessonReply(prompt)
    if (fault !== "privacy-canary") return draft
    return {
      ...draft,
      sections: draft.sections.map((section) => ({
        ...section,
        content: { ...section.content, en: "TASK31_PRIVATE_CANARY in projected study content" },
      })),
    }
  }
  throw new TypeError("Unexpected provider stage")
}

export async function startProductionWire(options?: {
  readonly port?: number
  readonly fault?: () => WireFault
  readonly onRequest?: (metric: {
    readonly bodyBytes: number
    readonly sectionId: string | null
    readonly fault: WireFault
    readonly provider: "openai" | "anthropic"
  }) => void
}) {
  const requests: unknown[] = []
  const metrics: {
    readonly bodyBytes: number
    readonly sectionId: string | null
    readonly fault: WireFault
    readonly provider: "openai" | "anthropic"
  }[] = []
  const held = new Set<ServerResponse>()
  let selectedFault: WireFault = "normal"
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks)
    const wireRequest: unknown = JSON.parse(body.toString())
    requests.push(wireRequest)
    const provider: "openai" | "anthropic" = request.url === "/v1/messages" ? "anthropic" : "openai"
    if (provider === "openai" && request.url !== "/v1/chat/completions")
      throw new TypeError("Unexpected wire protocol route")
    const messages = z
      .object({
        messages: z.array(
          z.object({
            content: z.union([
              z.string(),
              z.array(z.object({ type: z.string(), text: z.string().optional() })),
            ]),
          }),
        ),
      })
      .parse(wireRequest)
    const last = messages.messages.at(-1)?.content
    const prompt =
      typeof last === "string" ? last : (last?.map((part) => part.text ?? "").join("\n") ?? "")
    const outline = /Outline: (\{.*\}) Evidence:/s.exec(prompt)
    const sectionId = outline
      ? (z
          .object({ sections: z.array(z.object({ id: z.string() })) })
          .parse(JSON.parse(outline[1] ?? "")).sections[0]?.id ?? null)
      : null
    const fault = options?.fault?.() ?? selectedFault
    const metric = { bodyBytes: body.length, sectionId, fault, provider }
    metrics.push(metric)
    options?.onRequest?.(metric)
    if (fault === "hold") {
      held.add(response)
      response.once("close", () => held.delete(response))
      return
    }
    const text =
      fault === "malformed-output" ? "not-json" : JSON.stringify(reply(prompt, fault, provider))
    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify(
        provider === "anthropic"
          ? {
              id: "msg-matrix",
              type: "message",
              role: "assistant",
              model: "claude-sonnet-4-6",
              content: [{ type: "text", text }],
              stop_reason: "end_turn",
              usage: { input_tokens: 8, output_tokens: 4 },
            }
          : {
              id: "chatcmpl-manual",
              object: "chat.completion",
              created: 1,
              model: "gpt-4.1-mini",
              choices: [
                { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
              ],
              usage: { prompt_tokens: 8, completion_tokens: 4 },
            },
      ),
    )
  })
  server.listen(options?.port ?? 0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new TypeError("Missing wire address")
  return {
    requests,
    metrics,
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    setFault: (fault: WireFault) => {
      selectedFault = fault
    },
    releaseHeld: () => {
      for (const response of held) response.destroy()
    },
    close: () => {
      for (const response of held) response.destroy()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
