import {
  CoverageVerification,
  CoverageVerificationTarget,
  chapterFindings,
  coverageInterpretations,
  coverageTargetHash,
  coverageVerificationAccepted,
  coverageVerificationSchema,
  synthesisFindings,
} from "@reading-studio/contracts"
import {
  coverageVerificationStage,
  coverageVerificationTargets,
  WholeBookContext,
} from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { bookFixtureAuthority } from "./book-map-route-fixture.ts"
import { completeWholeBook, wholeBookFixture } from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

async function prepared(blocks = 1) {
  const fixture = await wholeBookFixture(
    `Opening rule. ${"日文 contextual material. ".repeat(100)}Late exception.`,
    blocks,
  )
  fixtures.push(fixture)
  const { analysis } = await completeWholeBook(fixture)
  const context = new WholeBookContext(bookFixtureAuthority(fixture), "setup-whole", "grant-whole")
  const map = analysis.wholeBook?.maps[0]
  const synthesis = analysis.wholeBook?.synthesis
  if (!map || !synthesis) throw new TypeError("Missing completed fixture findings")
  return { context, map, synthesis, fixture }
}

function supported(target: CoverageVerificationTarget) {
  return {
    decisions: coverageInterpretations(target).map((finding) => ({
      id: finding.id,
      verdict: "supported",
      explanation: "Scripted state control, not a semantic oracle.",
    })),
    mapCoverage:
      target.kind === "window"
        ? { verdict: "none", explanation: "Scripted no omission.", sources: [] }
        : null,
  }
}

it("loads the entire planned original window even when maps and synthesis cite only its beginning", async () => {
  // Given
  const { context } = await prepared()
  // When
  const stage = coverageVerificationStage(context, 0)
  // Then
  const identity = (range: {
    readonly resourcePath: string
    readonly blockId: string
    readonly start: number
    readonly end: number
  }) => [range.resourcePath, range.blockId, range.start, range.end]
  const window = context.scope.windows[0]
  if (!window) throw new TypeError("Missing first planned window")
  expect(stage.sourceRanges?.map(identity)).toEqual((window.ranges ?? [window]).map(identity))
})

it("accepts window-local not-addressed synthesis decisions without excusing omitted map content", async () => {
  // Given
  const { context, map, synthesis } = await prepared()
  const stage = coverageVerificationStage(context, 0)
  const reply = {
    decisions: [
      ...chapterFindings(map).map((finding) => ({
        id: finding.id,
        verdict: "supported",
        explanation: "Scripted map support.",
      })),
      ...synthesisFindings(synthesis).map((finding) => ({
        id: finding.id,
        verdict: "not-addressed",
        explanation: "Scripted unrelated window.",
      })),
    ],
    mapCoverage: {
      verdict: "none",
      explanation: "Scripted no material map omission.",
      sources: [],
    },
  }
  // When
  const parsed = stage.schema.safeParse(reply)
  // Then
  expect(parsed.success).toBe(true)
  const target = coverageVerificationTargets(context)[0]
  if (!target) throw new TypeError("Missing window target")
  expect(coverageVerificationAccepted(target, reply)).toBe(true)
})

it("assembles exactly W window targets plus one synthesis target without creating any jobs", async () => {
  // Given
  const { context, fixture } = await prepared(12)
  const before = fixture.storage.counts()
  // When
  const targets = coverageVerificationTargets(context)
  // Then
  expect(targets.map((target) => target.kind)).toEqual([
    ...context.scope.windows.map(() => "window"),
    "synthesis",
  ])
  expect(new Set(targets.map(coverageTargetHash)).size).toBe(context.scope.windows.length + 1)
  expect(context.scope.windows.length).toBeGreaterThan(1)
  const identity = (range: {
    readonly resourcePath: string
    readonly blockId: string
    readonly start: number
    readonly end: number
  }) => [range.resourcePath, range.blockId, range.start, range.end]
  expect(
    targets.flatMap((target) => (target.kind === "window" ? target.originals.map(identity) : [])),
  ).toEqual(context.scope.windows.flatMap((window) => (window.ranges ?? [window]).map(identity)))
  expect(fixture.storage.counts()).toEqual(before)
})

it("changes target identity for changed window originals or global synthesis even if map citations stay identical", async () => {
  // Given
  const { context } = await prepared()
  const target = coverageVerificationTargets(context)[0]
  if (target?.kind !== "window") throw new TypeError("Missing window target")
  // When
  const changedOriginal = CoverageVerificationTarget.parse({
    ...target,
    originals: target.originals.map((source) => ({
      ...source,
      originalFragment: source.originalFragment.replace("Late exception", "Late amendment"),
    })),
  })
  const changedSynthesis = CoverageVerificationTarget.parse({
    ...target,
    synthesis: {
      ...target.synthesis,
      thesis: target.synthesis.thesis.map((finding) => ({
        ...finding,
        text: "Changed global conclusion.",
      })),
    },
  })
  // Then
  expect(coverageTargetHash(changedOriginal)).not.toBe(coverageTargetHash(target))
  expect(coverageTargetHash(changedSynthesis)).not.toBe(coverageTargetHash(target))
})

it.each(["contradicted", "qualifies", "uncertain", "unsupported", "overstated", "not-addressed"])(
  "blocks a window when its own map finding is %s",
  async (verdict) => {
    // Given
    const { context } = await prepared()
    const target = coverageVerificationTargets(context)[0]
    if (!target) throw new TypeError("Missing target")
    const reply = supported(target)
    const first = reply.decisions[0]
    if (!first) throw new TypeError("Missing map finding")
    // When
    const accepted = coverageVerificationAccepted(target, {
      ...reply,
      decisions: [{ ...first, verdict }, ...reply.decisions.slice(1)],
    })
    // Then
    expect(accepted).toBe(false)
  },
)

it.each(["material-omission", "uncertain"])(
  "blocks a window with %s map coverage despite supported findings",
  async (verdict) => {
    // Given
    const { context } = await prepared()
    const target = coverageVerificationTargets(context)[0]
    if (target?.kind !== "window") throw new TypeError("Missing window target")
    const original = target.originals[0]
    if (!original) throw new TypeError("Missing original")
    const { resourcePath, blockId, start, end } = original
    // When
    const accepted = coverageVerificationAccepted(target, {
      ...supported(target),
      mapCoverage: {
        verdict,
        explanation: "Scripted missing original content.",
        sources: [{ resourcePath, blockId, start, end }],
      },
    })
    // Then
    expect(accepted).toBe(false)
  },
)

it("rejects missing map-omission assessment and invented omission offsets at the response boundary", async () => {
  // Given
  const { context } = await prepared()
  const target = coverageVerificationTargets(context)[0]
  if (target?.kind !== "window") throw new TypeError("Missing window target")
  const schema = coverageVerificationSchema(target)
  // When
  const missing = schema.safeParse({ ...supported(target), mapCoverage: null })
  const foreign = schema.safeParse({
    ...supported(target),
    mapCoverage: {
      verdict: "material-omission",
      explanation: "Foreign evidence.",
      sources: [{ resourcePath: "foreign.txt", blockId: "foreign-block", start: 0, end: 1 }],
    },
  })
  // Then
  expect(missing.success).toBe(false)
  expect(foreign.success).toBe(false)
})

it("does not treat not-addressed as support in the retained synthesis citation check", async () => {
  // Given
  const { context } = await prepared()
  const target = coverageVerificationTargets(context).at(-1)
  if (target?.kind !== "synthesis") throw new TypeError("Missing synthesis target")
  const reply = supported(target)
  // When
  const accepted = coverageVerificationAccepted(target, {
    ...reply,
    decisions: reply.decisions.map((decision) => ({ ...decision, verdict: "not-addressed" })),
  })
  // Then
  expect(accepted).toBe(false)
})

it("rejects target substitution and missing or duplicate decision IDs in a bound verification record", async () => {
  // Given
  const { context } = await prepared()
  const target = coverageVerificationTargets(context)[0]
  if (!target) throw new TypeError("Missing window target")
  const output = supported(target)
  const valid = { target, targetHash: coverageTargetHash(target), output }
  const first = output.decisions[0]
  if (!first) throw new TypeError("Missing decision")
  // When
  const checks = [
    CoverageVerification.safeParse(valid),
    CoverageVerification.safeParse({ ...valid, targetHash: "0".repeat(64) }),
    CoverageVerification.safeParse({
      ...valid,
      output: { ...output, decisions: output.decisions.slice(1) },
    }),
    CoverageVerification.safeParse({
      ...valid,
      output: { ...output, decisions: [first, ...output.decisions.slice(0, -1)] },
    }),
  ]
  // Then
  expect(checks.map((check) => check.success)).toEqual([true, false, false, false])
})
