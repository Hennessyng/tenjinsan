import { contentDigest, Digest, FullBookTestReceipt } from "@reading-studio/contracts"
import { acceptFullBookTestOutput } from "@reading-studio/generation/full-book-test"
import { expect, it } from "vitest"
import { fixtureTarget, fullBookSession, pluralMapOutput } from "./full-book-test-fixture.ts"

it("accepts a complete plural-group map as a source-bound immutable receipt", () => {
  // Given two groups in one primary window.
  const session = fullBookSession(),
    serialized = JSON.stringify(pluralMapOutput(session))
  // When the map crosses the output acceptance boundary.
  const receipts = acceptFullBookTestOutput(session, [], serialized)
  // Then only the exact source-bound output is added.
  expect(receipts).toEqual([{ serialized, outputHash: contentDigest(serialized) }])
  expect(Object.isFrozen(receipts)).toBe(true)
})

it.each(["group", "fragment", "citation", "duplicate", "target", "count", "bytes"])(
  "refuses %s corruption without accepting a partial map",
  (damage) => {
    // Given a valid map with one independently injected fault.
    const session = fullBookSession(),
      output = pluralMapOutput(session)
    const first = output.findings[0]
    if (!first) throw new TypeError("Missing fixture finding")
    switch (damage) {
      case "group":
        output.groupIds.pop()
        break
      case "fragment":
        output.coverage.pop()
        break
      case "citation":
        first.citations.push({
          kind: "fragment",
          fragmentId: Digest.parse("f".repeat(64)),
          start: 0,
          end: 1,
        })
        break
      case "duplicate":
        if (output.findings[0]) output.findings.push(output.findings[0])
        break
      case "target":
        output.targetHash = contentDigest("foreign target")
        break
      case "count":
        output.findings.push(
          ...Array.from({ length: 13 }, (_, id) => ({ ...first, id: `extra-${id}` })),
        )
        break
      case "bytes":
        output.findings[0] = { ...first, text: "x".repeat(17_000) }
        break
      default:
        throw new TypeError("Unknown fixture")
    }
    // When/Then invalid output cannot enter the accepted ledger.
    expect(() => acceptFullBookTestOutput(session, [], JSON.stringify(output))).toThrow()
  },
)

it("requires all child findings and exception text in a reduction", () => {
  // Given an accepted map and a reduction retaining its full contribution and citation references.
  const session = fullBookSession(),
    map = pluralMapOutput(session)
  const serialized = JSON.stringify(map)
  const receipts = [
    FullBookTestReceipt.parse({ serialized, outputHash: contentDigest(serialized) }),
  ]
  const reduction = {
    ...map,
    targetHash: fixtureTarget(session, receipts),
    children: [{ nodeId: "fb-0", outputHash: contentDigest(serialized) }],
    findings: map.findings.map((finding) => ({
      ...finding,
      citations: [{ kind: "child", nodeId: "fb-0", findingId: finding.id }],
    })),
    contributions: map.findings.map((finding) => ({
      childNodeId: "fb-0",
      findingId: finding.id,
      outputFindingIds: [finding.id],
      disposition: "retained",
      explanation: "Retained contribution",
    })),
  }
  // When the complete reduction is accepted.
  const after = acceptFullBookTestOutput(session, receipts, JSON.stringify(reduction))
  // Then it appends exactly one bound receipt.
  expect(after).toHaveLength(2)
})
