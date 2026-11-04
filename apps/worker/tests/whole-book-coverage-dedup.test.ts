import { coverageInterpretations, coverageTargetHash } from "@reading-studio/contracts"
import {
  coverageVerificationStage,
  coverageVerificationTargets,
  WholeBookContext,
  wholeBookFeasibility,
} from "@reading-studio/generation"
import {
  bookSourcePayload,
  legacyLocalReservationBytes as localRequestBytes,
  sourceRangesInput,
  structuredRequest,
} from "@reading-studio/providers"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { bookFixtureAuthority, bookFixtureCapacity } from "./book-map-route-fixture.ts"
import {
  coverageFixture,
  coverageGrantId,
  coverageSetupId,
  finishCoverage,
} from "./whole-book-coverage-fixture.ts"

const fixtures: Awaited<ReturnType<typeof coverageFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})
function findingObjects(input: unknown): readonly { id: string; text: string }[] {
  if (Array.isArray(input)) return input.flatMap((value: unknown) => findingObjects(value))
  if (typeof input !== "object" || input === null) return []
  const object = z.record(z.string(), z.unknown()).parse(input)
  const finding = z
    .object({ id: z.string(), text: z.string(), sources: z.array(z.unknown()) })
    .safeParse(object)
  return [
    ...(finding.success ? [finding.data] : []),
    ...Object.values(object).flatMap(findingObjects),
  ]
}

it.each(["window", "synthesis"] as const)(
  "sends %s findings once, keeping role IDs and rich target binding",
  async (kind) => {
    // Given
    const fixture = await coverageFixture()
    fixtures.push(fixture)
    await finishCoverage(fixture)
    const context = new WholeBookContext(
      bookFixtureAuthority(fixture),
      coverageSetupId,
      coverageGrantId,
    )
    const targets = coverageVerificationTargets(context)
    const index = kind === "window" ? 0 : targets.length - 1
    const target = targets[index]
    if (!target) throw new TypeError("Missing target")
    // When
    const stage = coverageVerificationStage(context, index)
    const payload = z.array(z.unknown()).parse(stage.derivedData)
    const body = z
      .object({
        targetHash: z.string(),
        map: z.object({ summary: z.unknown() }).nullable(),
        interpretations: z.array(z.unknown()),
      })
      .parse(payload[0])
    const observed = findingObjects(payload)
    const request = structuredRequest({
      model: context.setup.analysis.model,
      settings: context.setup.analysis.settings,
      instruction: stage.instruction,
      schema: z.toJSONSchema(stage.schema, { reused: "ref" }),
      blocks: [
        ...payload,
        ...bookSourcePayload(sourceRangesInput(context.approved, stage.sourceRanges ?? [])),
      ],
      signal: new AbortController().signal,
    })
    process.stdout.write(
      `${JSON.stringify({ event: "coverage-wire-measurement", kind, findings: observed.length, distinctFindings: new Set(observed.map((finding) => finding.id)).size, measuredRequestBytes: localRequestBytes("chatgpt-subscription", request), schemaBytes: Buffer.byteLength(JSON.stringify(request.schema)) })}\n`,
    )
    // Then
    for (const finding of coverageInterpretations(target))
      expect(observed.filter((item) => item.id === finding.id)).toHaveLength(1)
    expect(body.targetHash).toBe(coverageTargetHash(target))
    expect(stage.verificationTarget).toEqual(target)
    expect(body.interpretations).toEqual(coverageInterpretations(target))
    if (target.kind === "window") expect(body.map?.summary).toBe(target.map.summary.id)
  },
)

it("refuses ordinary unproven version3 feasibility without admitting work or expanding the grant", async () => {
  // Given
  const fixture = await coverageFixture()
  fixtures.push(fixture)
  const setup = fixture.storage.sources.getSetup(coverageSetupId)
  const normalization =
    setup && fixture.storage.sources.getNormalization(setup.analysis.normalizationRevisionId)
  if (!setup || !normalization) throw new TypeError("Missing draft inputs")
  const before = fixture.storage.counts()
  // When
  const result = await wholeBookFeasibility({
    setup,
    normalization,
    capacity: bookFixtureCapacity,
    cap: 64,
    used: 0,
  })
  // Then
  expect(result.kind).toBe("limited")
  if (result.kind === "limited") expect(result.failure.coverage.reason).toBe("capacity-limit")
  expect(fixture.storage.counts()).toEqual(before)
})
