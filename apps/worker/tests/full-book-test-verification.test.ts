import { Writable } from "node:stream"
import {
  assertNever,
  FullBookFinding,
  type FullBookTestReceipt,
  FullBookTestSession,
  planFullBookTest,
  WindowOriginal,
} from "@reading-studio/contracts"
import { fullBookTestRequest } from "@reading-studio/generation/full-book-test"
import { RpcFrameWriter } from "@reading-studio/storage"
import { expect, it } from "vitest"
import { z } from "zod"
import { FullBookTestRuntime } from "../src/full-book-test-runtime.ts"
import {
  fixtureTarget,
  fullBookSession,
  pluralMapOutput,
  reductionOutput,
} from "./full-book-test-fixture.ts"

function verification(session: FullBookTestSession, receipts: readonly FullBookTestReceipt[]) {
  const built = fullBookTestRequest(session, receipts)
  const body = z
    .tuple([z.unknown(), z.object({ findings: z.array(FullBookFinding) })])
    .parse(JSON.parse(built.request.prompt.slice(built.request.prompt.indexOf("\n") + 1)))[1]
  return {
    kind: "verification",
    targetHash: fixtureTarget(session, receipts),
    decisions: body.findings.map((finding) => ({
      findingId: finding.id,
      verdict: "supported",
      explanation: "Synthetic verdict",
    })),
    materialCoverage:
      built.target.node.kind === "map-check"
        ? { verdict: "none", explanation: "Synthetic coverage verdict" }
        : null,
  }
}

it("checks every original window against every fixed root batch with resolved original citation evidence", () => {
  // Given two windows with a fixed two-batch hierarchy and a disposable, unwritten native stream.
  const initial = fullBookSession(),
    input = {
      ...initial.input,
      windows: initial.input.windows.flat().map((original) => [original]),
    }
  const session = FullBookTestSession.parse({ ...initial, input, plan: planFullBookTest(input) })
  const runtime = new FullBookTestRuntime(session),
    writer = new RpcFrameWriter(
      "chatgpt-subscription",
      new Writable({
        write(_chunk, _encoding, callback) {
          callback()
        },
      }),
    )
  const observed: unknown[] = [],
    citationEvidence: unknown[] = []
  // When the isolated stage runtime receives explicitly synthetic complete/supported outputs.
  for (const node of session.plan.nodes) {
    const receipts = runtime.snapshot(),
      built = fullBookTestRequest(session, receipts)
    const body = z
      .tuple([
        z.unknown(),
        z.object({
          originals: z.array(WindowOriginal).optional(),
          citationOriginals: z
            .array(z.object({ fragmentId: z.string(), original: WindowOriginal }))
            .optional(),
        }),
      ])
      .parse(JSON.parse(built.request.prompt.slice(built.request.prompt.indexOf("\n") + 1)))[1]
    const job = runtime.prequeue(writer, "synthetic-thread")
    runtime.beforeDispatch(job, writer)
    let output: unknown
    switch (node.kind) {
      case "map":
        output = {
          ...pluralMapOutput(session, node.window ?? -1),
          targetHash: fixtureTarget(session, receipts),
        }
        break
      case "reduce":
        output = reductionOutput(session, receipts)
        break
      case "final-check":
        observed.push({ window: node.window, batch: node.batch, originals: body.originals })
        output = verification(session, receipts)
        break
      case "citation-check":
        citationEvidence.push(...(body.citationOriginals ?? []))
        output = verification(session, receipts)
        break
      case "map-check":
        output = verification(session, receipts)
        break
      default:
        assertNever(node.kind)
    }
    runtime.accept(job, JSON.stringify(output))
  }
  // Then no original window was replaced by a reduction or omitted from the fixed matrix.
  expect(observed).toEqual(
    [0, 1].flatMap((window) =>
      [0, 1].map((batch) => ({ window, batch, originals: session.input.windows[window] })),
    ),
  )
  expect(citationEvidence).toHaveLength(2)
  expect(runtime.snapshot()).toHaveLength(11)
})

it.each(["missing-verdict", "uncertain", "material-omission"])(
  "refuses %s at own-map verification",
  (damage) => {
    // Given the accepted map/reduction prefix and its exact own-map target.
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
    for (let index = 0; index < 2; index++) {
      const job = runtime.prequeue(writer, "synthetic-thread")
      runtime.beforeDispatch(job, writer)
      runtime.accept(
        job,
        JSON.stringify(
          index === 0 ? pluralMapOutput(session) : reductionOutput(session, runtime.snapshot()),
        ),
      )
    }
    const output = verification(session, runtime.snapshot())
    switch (damage) {
      case "missing-verdict":
        output.decisions.pop()
        break
      case "uncertain":
        if (output.decisions[0]) output.decisions[0].verdict = "uncertain"
        break
      case "material-omission":
        if (output.materialCoverage) output.materialCoverage.verdict = "material-omission"
        break
      default:
        throw new TypeError("Unknown fixture")
    }
    // When/Then no failed or incomplete semantic verdict can enter the accepted prefix.
    const job = runtime.prequeue(writer, "synthetic-thread")
    runtime.beforeDispatch(job, writer)
    expect(() => runtime.accept(job, JSON.stringify(output))).toThrow()
    expect(runtime.snapshot()).toHaveLength(2)
  },
)
