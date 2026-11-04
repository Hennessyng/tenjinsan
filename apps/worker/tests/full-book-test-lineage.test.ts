import {
  ContentId,
  contentDigest,
  FullBookNodeId,
  FullBookTestSession,
  planFullBookTest,
} from "@reading-studio/contracts"
import { acceptFullBookTestOutput } from "@reading-studio/generation/full-book-test"
import { expect, it } from "vitest"
import { fullBookSession, pluralMapOutput, reductionOutput } from "./full-book-test-fixture.ts"

it.each([
  "child",
  "child-hash",
  "group",
  "coverage",
  "contribution",
  "omitted",
  "exception",
  "citation",
  "duplicate",
  "cycle",
  "order",
])("rejects reduction %s corruption before ledger acceptance", (damage) => {
  // Given a valid accepted map and otherwise valid reduction.
  const session = fullBookSession(),
    receipts = acceptFullBookTestOutput(session, [], JSON.stringify(pluralMapOutput(session)))
  const output = reductionOutput(session, receipts),
    first = output.findings[0]
  if (!first) throw new TypeError("Missing fixture finding")
  switch (damage) {
    case "child":
      output.children.pop()
      break
    case "child-hash":
      if (output.children[0]) output.children[0].outputHash = contentDigest("foreign")
      break
    case "group":
      output.groupIds.pop()
      break
    case "coverage":
      output.coverage.pop()
      break
    case "contribution":
      output.contributions.pop()
      break
    case "omitted":
      if (output.contributions[0]) output.contributions[0].disposition = "omitted"
      break
    case "exception": {
      const exception = output.findings.find((finding) => finding.kind === "qualification")
      if (!exception) throw new TypeError("Missing fixture exception")
      exception.text = "The exception disappeared"
      break
    }
    case "citation":
      first.citations[0] = {
        kind: "child",
        nodeId: FullBookNodeId.parse("fb-999"),
        findingId: ContentId.parse(first.id),
      }
      break
    case "duplicate":
      output.findings.push(first)
      break
    case "cycle":
      first.citations[0] = {
        kind: "child",
        nodeId: FullBookNodeId.parse("fb-1"),
        findingId: ContentId.parse(first.id),
      }
      break
    case "order":
      output.contributions.reverse()
      break
    default:
      throw new TypeError("Unknown fixture")
  }
  // When/Then corrupted output cannot append a receipt or change the accepted prefix.
  expect(() => acceptFullBookTestOutput(session, receipts, JSON.stringify(output))).toThrow()
  expect(receipts).toHaveLength(1)
})

it("binds restored targets to policy, source, version and destination rather than a generic cache key", () => {
  // Given a valid source-bound output and a later separately planned policy.
  const session = fullBookSession(),
    receipts = acceptFullBookTestOutput(session, [], JSON.stringify(pluralMapOutput(session)))
  const input = { ...session.input, policy: { ...session.input.policy, maxFindings: 11 } }
  const changed = FullBookTestSession.parse({ ...session, input, plan: planFullBookTest(input) })
  // When/Then the previous receipt cannot be restored under a new target.
  expect(() =>
    acceptFullBookTestOutput(changed, receipts, JSON.stringify(reductionOutput(changed, receipts))),
  ).toThrow()
})
