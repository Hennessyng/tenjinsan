import {
  acceptFullBookTestOutput,
  contentDigest,
  FullBookOutputError,
  FullBookVerificationOutput,
  fullBookTestRequest,
  fullBookUnusedBatch,
  restoreFullBookTest,
} from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { z } from "zod"
import { directFixture } from "./full-book-direct-fixture.ts"
import { directOutput } from "./full-book-direct-output.ts"

it("accepts attributed consolidation with hashed contribution pointers rather than verbatim exception copies", () => {
  // Given a versioned root consolidating both direct children's material qualifications.
  const f = directFixture()
  // When the root is accepted, then structural lineage succeeds without a text-equality fidelity claim.
  expect(acceptFullBookTestOutput(f.session, f.receipts, JSON.stringify(f.output))).toHaveLength(3)
})
it("loads complete own-map evidence and originals beside each root finding batch", () => {
  // Given accepted consolidation, with no requirement that it repeat every exception word for word.
  const f = directFixture()
  let receipts = acceptFullBookTestOutput(f.session, f.receipts, JSON.stringify(f.output))
  for (let index = 0; index < 2; index++) {
    const built = fullBookTestRequest(f.session, receipts)
    const body = z
      .tuple([
        z.unknown(),
        z.object({
          originals: z.array(z.unknown()),
          localMap: z.object({ outputHash: z.string(), findings: z.array(z.unknown()) }),
        }),
      ])
      .parse(JSON.parse(built.request.prompt.slice(built.request.prompt.indexOf("\n") + 1)))[1]
    expect(body.originals).toEqual(f.session.input.windows[index])
    expect(body.localMap.findings).toEqual(f.maps[index]?.findings)
    receipts = acceptFullBookTestOutput(
      f.session,
      receipts,
      JSON.stringify(directOutput(f.session, receipts)),
    )
  }
  // When final checks are built, then non-cited counterevidence is actually loaded from the local map and originals.
  const built = fullBookTestRequest(f.session, receipts)
  const body = z
    .tuple([
      z.unknown(),
      z.object({
        findings: z.array(z.unknown()),
        originals: z.array(z.unknown()),
        localMap: z.object({ findings: z.array(z.unknown()) }),
      }),
    ])
    .parse(JSON.parse(built.request.prompt.slice(built.request.prompt.indexOf("\n") + 1)))[1]
  expect(body.findings).toEqual(f.output.findings)
  expect(body.originals).toEqual(f.session.input.windows[0])
  expect(body.localMap.findings).toEqual(f.maps[0]?.findings)
  const checked = FullBookVerificationOutput.parse(directOutput(f.session, receipts))
  expect(() =>
    acceptFullBookTestOutput(
      f.session,
      receipts,
      JSON.stringify({
        ...checked,
        materialCoverage: {
          verdict: "material-omission",
          explanation: "Material counterevidence was lost despite valid structural pointers.",
        },
      }),
    ),
  ).toThrow(FullBookOutputError)
  expect(() =>
    acceptFullBookTestOutput(
      f.session,
      receipts,
      JSON.stringify({
        ...checked,
        decisions: checked.decisions.map((decision) => ({ ...decision, verdict: "unsupported" })),
      }),
    ),
  ).toThrow(FullBookOutputError)
  const damaged = {
    ...f.session,
    input: {
      ...f.session.input,
      normalization: { ...f.session.input.normalization, resources: [] },
    },
  }
  expect(() => fullBookTestRequest(damaged, receipts)).toThrow()
})
it("rejects empty roots, stale root hashes and changed-policy replay for unused batches", () => {
  // Given a root-bound not-needed receipt from the old accepted root.
  const f = directFixture(),
    serialized = JSON.stringify(f.output),
    root = { serialized, outputHash: contentDigest(serialized) }
  const proof = fullBookUnusedBatch(f.session, root, 6)
  expect(proof?.kind).toBe("not-needed")
  expect(() =>
    fullBookUnusedBatch(f.session, { ...root, outputHash: contentDigest("foreign root") }, 6),
  ).toThrow()
  const empty = JSON.stringify({ ...f.output, findings: [] })
  expect(() =>
    fullBookUnusedBatch(f.session, { serialized: empty, outputHash: contentDigest(empty) }, 6),
  ).toThrow()
  let receipts = acceptFullBookTestOutput(
    f.session,
    f.receipts,
    JSON.stringify({
      ...f.output,
      findings: f.output.findings.map((finding) => ({
        ...finding,
        text: "Changed root meaning needs fresh checks, not a reused release proof.",
      })),
    }),
  )
  while (receipts.length < 6)
    receipts = acceptFullBookTestOutput(
      f.session,
      receipts,
      JSON.stringify(directOutput(f.session, receipts)),
    )
  // When/Then an old root's release proof cannot be accepted against the changed root.
  expect(() => acceptFullBookTestOutput(f.session, receipts, JSON.stringify(proof))).toThrow()
  expect(() =>
    restoreFullBookTest(
      { ...f.session, input: { ...f.session.input, hierarchyPolicy: undefined } },
      f.receipts,
    ),
  ).toThrow()
})
it.each(["pointer", "hash", "missing-hash", "contribution"])(
  "refuses a dropped or tampered %s",
  (change) => {
    // Given an otherwise valid consolidation with a damaged immutable reference.
    const f = directFixture()
    const output = {
      ...f.output,
      findings: f.output.findings.map((finding, index) =>
        index === 2
          ? {
              ...finding,
              citations:
                change === "pointer"
                  ? finding.citations.slice(1)
                  : finding.citations.map((citation) =>
                      change === "hash"
                        ? { ...citation, outputHash: "f".repeat(64) }
                        : change === "missing-hash"
                          ? { ...citation, outputHash: undefined }
                          : citation,
                    ),
            }
          : finding,
      ),
      contributions:
        change === "contribution" ? f.output.contributions.slice(1) : f.output.contributions,
    }
    // When/Then replay validation fails before any summary becomes usable.
    expect(() => acceptFullBookTestOutput(f.session, f.receipts, JSON.stringify(output))).toThrow()
  },
)
it("loads direct child findings for synthesis without recursively serializing their receipts", () => {
  // Given actual child map content, not IDs alone.
  const f = directFixture()
  // When building the reduction request, then direct readable findings are present and descendant contribution ledgers are absent.
  const built = fullBookTestRequest(f.session, f.receipts)
  const body = z
    .tuple([
      z.unknown(),
      z.object({
        children: z.array(
          z.object({
            findings: z.unknown(),
            output: z.unknown().optional(),
            outputHash: z.string(),
          }),
        ),
      }),
    ])
    .parse(JSON.parse(built.request.prompt.slice(built.request.prompt.indexOf("\n") + 1)))[1]
  expect(body.children[0]?.findings).toEqual(
    f.maps[0]?.findings.map((finding) => ({
      id: finding.id,
      kind: finding.kind,
      text: finding.text,
      groupIndexes: finding.groupIds.map((id) => f.maps[0]?.groupIds.indexOf(id)),
    })),
  )
  expect(body.children[0]?.output).toBeUndefined()
  expect(body.children[0]?.outputHash).toBe(f.receipts[0]?.outputHash)
  expect(() =>
    restoreFullBookTest(
      f.session,
      f.receipts.map((receipt, index) =>
        index ? receipt : { ...receipt, outputHash: "f".repeat(64) },
      ),
    ),
  ).toThrow(FullBookOutputError)
})
