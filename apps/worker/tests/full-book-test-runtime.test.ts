import { Writable } from "node:stream"
import {
  contentDigest,
  FullBookAnalysisOutput,
  FullBookTestSession,
  planFullBookTest,
} from "@reading-studio/contracts"
import {
  acceptFullBookTestOutput,
  fullBookTestRequest,
  packFullBookTest,
} from "@reading-studio/generation/full-book-test"
import { RpcFrameWriter } from "@reading-studio/storage"
import { expect, it } from "vitest"
import { z } from "zod"
import { FullBookTestRuntime } from "../src/full-book-test-runtime.ts"
import { fullBookSession, pluralMapOutput } from "./full-book-test-fixture.ts"

function frameWriter() {
  return new RpcFrameWriter(
    "chatgpt-subscription",
    new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    }),
  )
}

it("packs adjacent groups using the real plural-map frame without transmitting anything", () => {
  // Given source already separated into two valid windows.
  const session = fullBookSession(),
    input = { ...session.input, windows: session.input.windows.flat().map((span) => [span]) }
  const initial = FullBookTestSession.parse({ ...session, input, plan: planFullBookTest(input) })
  // When preconsent packing measures the actual app serialization.
  const packed = packFullBookTest(initial, { threadId: "synthetic-thread", rpcId: 1 })
  // Then both groups share one source-complete window and no dispatch occurs.
  expect(packed.input.windows).toHaveLength(1)
  expect(packed.input.windows.flat()).toEqual(session.input.windows.flat())
})

it("checks the exact owned frame both prequeue and immediately before dispatch", () => {
  // Given an explicitly opted-in synthetic runtime and a native frame writer.
  const runtime = new FullBookTestRuntime(fullBookSession()),
    writer = frameWriter()
  // When a job is prepared and rechecked without writing it.
  const job = runtime.prequeue(writer, "synthetic-thread"),
    observation = runtime.beforeDispatch(job, writer)
  // Then observations bind the entire actual frame, not a source-only size.
  expect(observation.bytes).toBe(job.frame.bytes)
  expect(observation.hash).toBe(job.requestHash)
})

it.each(["flag", "purpose", "bytes", "forged-frame"])(
  "refuses %s admission or dispatch",
  (damage) => {
    // Given a bounded synthetic session with one invalid control.
    const session = fullBookSession(),
      writer = frameWriter()
    // When/Then the isolated path cannot borrow a normal-purpose or altered frame.
    switch (damage) {
      case "flag":
        expect(() => new FullBookTestRuntime({ ...session, enabled: false })).toThrow()
        break
      case "purpose":
        expect(
          () => new FullBookTestRuntime({ ...session, purpose: "analysis-evaluation-1" }),
        ).toThrow()
        break
      case "bytes": {
        const input = { ...session.input, policy: { ...session.input.policy, maxAppBytes: 1 } }
        const runtime = new FullBookTestRuntime({
          ...session,
          input,
          plan: planFullBookTest(input),
        })
        expect(() => runtime.prequeue(writer, "synthetic-thread")).toThrow()
        break
      }
      case "forged-frame": {
        const runtime = new FullBookTestRuntime(session),
          job = runtime.prequeue(writer, "synthetic-thread")
        expect(() =>
          runtime.beforeDispatch({ ...job, requestHash: contentDigest("forged") }, writer),
        ).toThrow()
        break
      }
      default:
        throw new TypeError("Unknown fixture")
    }
  },
)

it("revalidates restored receipt hashes rather than trusting a saved success label", () => {
  // Given an accepted map in a synthetic receipt ledger.
  const session = fullBookSession(),
    receipts = acceptFullBookTestOutput(session, [], JSON.stringify(pluralMapOutput(session)))
  // When its saved output hash is corrupted.
  const corrupted = receipts.map((receipt) => ({
    ...receipt,
    outputHash: contentDigest("foreign"),
  }))
  // Then restoration refuses before any request is prepared.
  expect(() => new FullBookTestRuntime(session, corrupted)).toThrow()
})

it("passes complete child output and receipt identity into the next reduction", () => {
  // Given a complete accepted analysis prefix followed by synthetic supported checks.
  const session = fullBookSession(),
    runtime = new FullBookTestRuntime(session),
    writer = frameWriter()
  const job = runtime.prequeue(writer, "synthetic-thread")
  runtime.beforeDispatch(job, writer)
  runtime.accept(job, JSON.stringify(pluralMapOutput(session)))
  // When the next reduction request is assembled.
  const built = fullBookTestRequest(session, runtime.snapshot())
  // Then actual complete child output and ordered child receipt identity are present.
  const blocks = z
    .tuple([
      z.object({ children: z.array(z.object({ outputHash: z.string() })) }),
      z.object({ children: z.array(z.object({ output: FullBookAnalysisOutput })) }),
    ])
    .parse(JSON.parse(built.request.prompt.slice(built.request.prompt.indexOf("\n") + 1)))
  expect(blocks[1].children[0]?.output.coverage).toEqual(pluralMapOutput(session).coverage)
  expect(blocks[0].children[0]?.outputHash).toBe(runtime.snapshot()[0]?.outputHash)
})
