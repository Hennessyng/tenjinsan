import {
  COVERAGE_VERIFICATION_VERSION,
  EXPERIMENTAL_COVERAGE_OPT_IN_VERSION,
  NormalizationRevision,
  StudySetupRevision,
  wholeBookScope,
} from "@reading-studio/contracts"
import { storedBookPlan, wholeBookFeasibility } from "@reading-studio/generation"
import { z } from "zod"
import {
  fixtureCapacity,
  WholeBookAdapter,
  wholeBookFixture,
  wholeBookWorker,
} from "./whole-book-fixture.ts"

export const coverageSetupId = "setup-coverage"
export const coverageGrantId = "grant-coverage"
export async function coverageFixture(
  text = `Opening rule. ${"source context. ".repeat(55)}Late exception.`,
  blocks = 2,
  explicitOptIn = true,
) {
  const fixture = await wholeBookFixture(text, blocks)
  const old = fixture.storage.sources.getSetup("setup-whole")
  const grant = fixture.storage.sources.getGrant("grant-whole")
  const original = fixture.storage.sources.getNormalization("normalization-1")
  if (!old || !grant || !original) throw new TypeError("Missing baseline fixture")
  const normalization = NormalizationRevision.parse({
    ...original,
    id: "normalization-coverage",
    resources: original.resources.map((resource) =>
      resource.status === "included"
        ? {
            ...resource,
            blocks: resource.blocks.flatMap((block, index) => [
              { id: `heading-${block.id}`, text: `Part ${index + 1}`, heading: 1 },
              block,
            ]),
          }
        : resource,
    ),
  })
  fixture.storage.sources.appendNormalization({
    record: normalization,
    parentRevisionId: original.id,
  })
  const proposal = StudySetupRevision.parse({
    ...old,
    id: coverageSetupId,
    analysis: {
      ...old.analysis,
      normalizationRevisionId: normalization.id,
      scope: wholeBookScope(normalization),
      processing: { ...old.analysis.processing, plan: undefined },
    },
  })
  const planned = await wholeBookFeasibility({
    setup: proposal,
    normalization,
    capacity: fixtureCapacity,
    cap: 64,
    used: 0,
  })
  if (planned.kind !== "ready")
    throw new TypeError(`Fixture map planning failed: ${planned.failure.coverage.reason}`)
  fixture.storage.sources.appendSetup({
    record: {
      ...proposal,
      ...(explicitOptIn
        ? {
            experimentalCoverageOptIn: {
              version: EXPERIMENTAL_COVERAGE_OPT_IN_VERSION,
              enabled: true,
            },
          }
        : {}),
      analysis: {
        ...proposal.analysis,
        processing: {
          ...proposal.analysis.processing,
          synthesisVersion: COVERAGE_VERIFICATION_VERSION,
          plan: storedBookPlan(planned.windows),
        },
      },
    },
    parentRevisionId: old.id,
  })
  fixture.storage.sources.appendGrant({
    ...grant,
    id: coverageGrantId,
    setupRevisionId: coverageSetupId,
  })
  return fixture
}

const Input = z.object({
  kind: z.string(),
  verificationVersion: z.string().optional(),
  scope: z.object({ kind: z.string() }).optional(),
  interpretations: z.array(z.object({ id: z.string() })).optional(),
  map: z.object({ partId: z.string() }).nullable().optional(),
})
const Range = z.object({
  resourcePath: z.string(),
  blockId: z.string(),
  start: z.number(),
  end: z.number(),
})
export class CoverageAdapter extends WholeBookAdapter {
  constructor(
    readonly mode:
      | "not-addressed"
      | "material-omission"
      | "contradicted"
      | "qualifies"
      | "uncertain" = "not-addressed",
  ) {
    super()
  }
  override async dispatch(request: Parameters<WholeBookAdapter["dispatch"]>[0]) {
    const result = await super.dispatch(request)
    const payload = z
      .array(z.unknown())
      .parse(JSON.parse(request.prompt.slice(request.prompt.lastIndexOf("\n") + 1)))
    const input = Input.parse(payload[0])
    if (input.verificationVersion !== COVERAGE_VERIFICATION_VERSION) return result
    const window = input.scope?.kind === "window"
    const source = window ? Range.parse(payload.at(-1)) : null
    const sources = source && this.mode === "material-omission" ? [source] : []
    return {
      ...result,
      kind: "output" as const,
      text: JSON.stringify({
        decisions: (input.interpretations ?? []).map((finding) => ({
          id: finding.id,
          verdict:
            window &&
            !finding.id.startsWith(`${input.map?.partId}-`) &&
            this.mode !== "material-omission"
              ? this.mode
              : "supported",
          explanation: "Authored state control, not a semantic oracle.",
        })),
        mapCoverage: window
          ? {
              verdict: this.mode === "material-omission" ? "material-omission" : "none",
              explanation: "Authored map omission state.",
              sources,
            }
          : null,
      }),
    }
  }
}

export async function finishCoverage(
  fixture: Awaited<ReturnType<typeof coverageFixture>>,
  adapter = new CoverageAdapter(),
  capacity = fixtureCapacity,
) {
  const run = wholeBookWorker(fixture, adapter, capacity)
  let analysis = run.pipeline.prepare(coverageSetupId, coverageGrantId)
  for (let step = 0; step < 64; step++) {
    if ((await run.worker.runNext()).kind === "idle") break
    analysis = run.pipeline.prepare(coverageSetupId, coverageGrantId)
  }
  return { ...run, analysis }
}
