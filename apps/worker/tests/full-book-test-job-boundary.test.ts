import { Writable } from "node:stream"
import { RpcFrameWriter } from "@reading-studio/storage"
import { expect, it } from "vitest"
import { FullBookTestRuntime } from "../src/full-book-test-runtime.ts"
import { fullBookSession, pluralMapOutput, reductionOutput } from "./full-book-test-fixture.ts"

it("rejects a valid next-node output received under a stale prepared job", () => {
  // Given two prepared jobs for the same map and one already accepted result.
  const session = fullBookSession(),
    runtime = new FullBookTestRuntime(session)
  const writer = new RpcFrameWriter(
    "chatgpt-subscription",
    new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    }),
  )
  const first = runtime.prequeue(writer, "synthetic-thread"),
    stale = runtime.prequeue(writer, "synthetic-thread")
  runtime.beforeDispatch(first, writer)
  runtime.beforeDispatch(stale, writer)
  runtime.accept(first, JSON.stringify(pluralMapOutput(session)))
  // When/Then the stale map job cannot accept a well-formed reduction for another target.
  expect(() =>
    runtime.accept(stale, JSON.stringify(reductionOutput(session, runtime.snapshot()))),
  ).toThrow()
  expect(runtime.snapshot()).toHaveLength(1)
})

it("consumes a rejected response without an uncounted same-job repair", () => {
  // Given one prepared map job whose first response is malformed.
  const session = fullBookSession(),
    runtime = new FullBookTestRuntime(session)
  const writer = new RpcFrameWriter(
    "chatgpt-subscription",
    new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    }),
  )
  const job = runtime.prequeue(writer, "synthetic-thread")
  runtime.beforeDispatch(job, writer)
  expect(() => runtime.accept(job, "not-json")).toThrow()
  // When/Then a corrected response cannot silently reuse that same job/attempt boundary.
  expect(() => runtime.accept(job, JSON.stringify(pluralMapOutput(session)))).toThrow()
  expect(runtime.snapshot()).toHaveLength(0)
})
