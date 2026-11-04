import { rmSync } from "node:fs"
import { COVERAGE_VERIFICATION_VERSION } from "@reading-studio/contracts"
import { BookMapPipeline } from "@reading-studio/generation"
import {
  legacyLocalReservationBytes as localRequestBytes,
  ProviderAdapter,
  type ProviderReceipt,
  ProviderRunner,
  type StructuredRequest,
} from "@reading-studio/providers"
import { z } from "zod"
import { questionsStage, saveQuestions } from "../src/production-questions.ts"
import { WorkerRuntime } from "../src/runtime.ts"
import { bookMapFixture, FixtureAdapter, reviewedBookSetup } from "./book-map-fixture.ts"
import {
  bookFixtureAuthority,
  bookFixtureCapacity,
  bookFixtureProvider,
  bookFixtureTurns,
  closeBookRoute,
} from "./book-map-route-fixture.ts"
import { fixtureBatchReply } from "./whole-book-batch-reply.ts"
import { fixtureQuestionReply } from "./whole-book-question-reply.ts"

export async function wholeBookFixture(
  text = "A synthetic chapter. Its apparent rule has exceptions.",
  blocks = 1,
) {
  const fixture = bookMapFixture(text, blocks, true)
  await reviewedBookSetup(fixture, fixtureCapacity)
  const result = {
    ...fixture,
    close: async () => {
      await closeBookRoute(result.storage)
      result.storage.close()
      rmSync(result.directory, { recursive: true, force: true })
    },
  }
  return result
}

export const fixtureCapacity = bookFixtureCapacity
const Envelope = z.object({
  kind: z.enum(["chapter-map", "book-synthesis", "original-verification"]),
})
const Source = z.object({
  resourcePath: z.string(),
  blockId: z.string(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
})
const Interpretation = z.object({ id: z.string(), text: z.string() })

export class WholeBookAdapter extends FixtureAdapter {
  constructor(
    readonly verdict: "supported" | "overstated" = "supported",
    readonly noClaim = false,
    readonly provider: "openrouter" | "anthropic" | "chatgpt-subscription" = "chatgpt-subscription",
  ) {
    super()
  }
  async measure(request: StructuredRequest) {
    if (this.provider === "chatgpt-subscription") return localRequestBytes(this.provider, request)
    return new ProviderAdapter({
      provider: this.provider,
      apiKey: "synthetic-sizing-only",
    }).measure(request)
  }
  override async dispatch(request: StructuredRequest): Promise<ProviderReceipt> {
    const question = fixtureQuestionReply(request)
    if (question) {
      this.requests.push(request)
      return question
    }
    this.requests.push(request)
    const payload = z
      .array(z.unknown())
      .parse(JSON.parse(request.prompt.slice(request.prompt.lastIndexOf("\n") + 1)))
    const batch = fixtureBatchReply(payload[0], this.verdict)
    if (batch) return batch
    const envelope = Envelope.parse(payload[0])
    let output: unknown
    switch (envelope.kind) {
      case "chapter-map": {
        const blocks = z.array(Source).parse(payload.slice(1))
        const first = blocks[0]
        if (!first) throw new TypeError("No original text supplied to fixture")
        const statement = {
          text: this.noClaim
            ? "A reference list, not an argument."
            : "Synthetic interpretation with a qualification.",
          citations: [
            {
              resourcePath: first.resourcePath,
              blockId: first.blockId,
              start: first.start,
              end: Math.min(first.start + 12, first.end),
            },
          ],
        }
        output = {
          complete: true,
          claimStatus: this.noClaim ? "no-claim" : "claims",
          purpose: statement,
          claims: this.noClaim ? [] : [statement],
          concepts: [],
          definitions: [],
          examples: [],
          qualifications: [statement],
          uncertainties: [],
          summary: statement,
        }
        break
      }
      case "book-synthesis": {
        const input = z
          .object({
            groupIds: z.array(z.string()),
            maps: z.array(
              z.object({
                summary: z.object({
                  text: z.string(),
                  sources: z.array(
                    z.object({
                      resourcePath: z.string(),
                      blockId: z.string(),
                      start: z.number(),
                      end: z.number(),
                    }),
                  ),
                }),
              }),
            ),
          })
          .parse(payload[0])
        const summary = input.maps[0]?.summary
        if (!summary) throw new TypeError("Synthesis did not receive complete maps")
        const statement = {
          text: "The argument develops while retaining its exceptions.",
          citations: summary.sources,
        }
        output = {
          complete: true,
          representedGroupIds: input.groupIds,
          thesis: [statement],
          progression: [statement],
          connections: [],
          conflicts: [],
          changesOfPosition: [],
          uncertainties: [],
        }
        break
      }
      case "original-verification": {
        const input = z
          .object({
            interpretations: z.array(Interpretation),
            verificationVersion: z.string().optional(),
            mapCoverageRequired: z.boolean().optional(),
          })
          .parse(payload[0])
        z.array(Source).min(1).parse(payload.slice(1))
        output = {
          decisions: input.interpretations.map((item) => ({
            id: item.id,
            verdict: this.verdict,
            explanation: "Authored synthetic verdict; not a live semantic assessment.",
          })),
          ...(input.verificationVersion === COVERAGE_VERIFICATION_VERSION
            ? {
                mapCoverage: input.mapCoverageRequired
                  ? {
                      verdict: "none",
                      explanation: "Authored synthetic omission state; not a live assessment.",
                      sources: [],
                    }
                  : null,
              }
            : {}),
        }
        break
      }
      default:
        throw new TypeError(`Unexpected fixture request ${envelope.kind satisfies never}`)
    }
    return {
      kind: "output",
      text: JSON.stringify(output),
      usage: { kind: "known", inputTokens: 10, outputTokens: 10 },
    }
  }
}

export function wholeBookWorker(
  fixture: Awaited<ReturnType<typeof wholeBookFixture>>,
  adapter = new WholeBookAdapter(),
  capacity = fixtureCapacity,
) {
  const authority = bookFixtureAuthority(fixture, capacity)
  const pipeline = new BookMapPipeline(authority)
  const clock = () => new Date("2026-10-23T00:00:00Z")
  const worker = new WorkerRuntime({
    storage: fixture.storage,
    clock,
    leaseDurationMs: 120000,
    tokenFactory: () => "whole-book-worker",
    attemptIdFactory: (n) => `whole-attempt-${n}`,
    resolveStage: (job) => ({
      kind: "structured",
      runner: new ProviderRunner({
        ...authority,
        clock,
        adapters: {
          "chatgpt-subscription": bookFixtureProvider({
            fixture,
            authority,
            job,
            authored: adapter,
          }),
        },
      }),
      request:
        job.stage === "questions"
          ? {
              ...questionsStage(fixture.storage, job),
              onValidated: () => saveQuestions(fixture.storage, job),
            }
          : pipeline.stage(job),
    }),
  })
  return { pipeline, worker, adapter }
}

export async function completeWholeBook(
  fixture: Awaited<ReturnType<typeof wholeBookFixture>>,
  adapter = new WholeBookAdapter(),
) {
  const run = wholeBookWorker(fixture, adapter)
  let analysis = run.pipeline.prepare("setup-whole", "grant-whole")
  for (let step = 0; step < 64; step++) {
    if ((await run.worker.runNext()).kind === "idle") break
    analysis = run.pipeline.prepare("setup-whole", "grant-whole")
  }
  if (bookFixtureTurns(fixture).length !== adapter.requests.length)
    throw new TypeError("Authored/native fixture call mismatch")
  return { ...run, analysis }
}
