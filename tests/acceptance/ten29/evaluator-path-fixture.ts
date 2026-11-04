import {
  COVERAGE_VERIFICATION_VERSION,
  chapterFindings,
  synthesisFindings,
} from "@reading-studio/contracts"
import { legacyLocalReservationBytes as localRequestBytes } from "@reading-studio/providers"
import { z } from "zod"
import { bookFixtureTurns } from "../../../apps/worker/tests/book-map-route-fixture.ts"
import { wholeBookWorker } from "../../../apps/worker/tests/whole-book-fixture.ts"
import { corpus } from "./corpus-support.ts"
import { CoverageControlAdapter, type CoverageState } from "./coverage-control-adapter.ts"
import { EvidenceControlAdapter } from "./evaluator-adapter.ts"
import type { EvaluatorControl } from "./evaluator-controls-v1.ts"
import { auditOriginalAssembly, type RequiredOriginal } from "./evaluator-evidence.ts"
import { persistedCorpus } from "./persisted-corpus.ts"
import { WireRange, wirePayload } from "./processing-evidence.ts"

export async function exerciseEvaluatorControl(
  control: EvaluatorControl,
  coverageState?: CoverageState,
  compactMap = true,
) {
  const family = corpus.find((item) => item.id === control.family)
  if (!family) throw new TypeError("Missing immutable control family")
  const fixture = await persistedCorpus(
    family,
    "epub",
    coverageState ? { synthesisVersion: COVERAGE_VERIFICATION_VERSION } : {},
  )
  try {
    const authored = new EvidenceControlAdapter(control)
    const adapter = coverageState
      ? new CoverageControlAdapter(authored, coverageState, compactMap)
      : authored
    const run = wholeBookWorker(fixture, adapter)
    let analysis = run.pipeline.prepare("setup-whole", "grant-whole")
    for (let step = 0; step < 12; step++) {
      if ((await run.worker.runNext()).kind === "idle") break
      analysis = run.pipeline.prepare("setup-whole", "grant-whole")
    }
    const data = analysis.wholeBook
    if (!data?.synthesis) throw new TypeError("Control did not reach synthesis")
    const required: RequiredOriginal[] = family.parts.map((part, index) => {
      const resourcePath = `book/${index + 1}.xhtml`
      const resource = fixture.normalization.resources.find((item) => item.path === resourcePath)
      const block = resource?.status === "included" ? resource.blocks[0] : undefined
      if (!block || block.text !== part.text)
        throw new TypeError("Source control no longer matches stored original")
      return { part: part.id, resourcePath, blockId: block.id, text: part.text }
    })
    const requests = adapter.requests.map((request) => ({
      payload: wirePayload(request.prompt),
      prompt: request.prompt,
      measuredRequestBytes: localRequestBytes("chatgpt-subscription", request),
    }))
    const nativeTurns = z
      .array(z.object({ input: z.array(z.object({ type: z.literal("text"), text: z.string() })) }))
      .parse(bookFixtureTurns(fixture))
    if (nativeTurns.length !== requests.length)
      throw new TypeError("Missing observed fake-native turn")
    const native = nativeTurns.map((turn, index) => {
      const text = turn.input[0]?.text
      if (!text) throw new TypeError("Missing observed original wire body")
      const payload = wirePayload(text)
      if (JSON.stringify(payload) !== JSON.stringify(requests[index]?.payload))
        throw new TypeError("Native evidence differs from prepared request")
      return { payload }
    })
    const mapInputs = requests
      .filter(
        (request) =>
          z.object({ kind: z.string() }).parse(request.payload[0]).kind === "chapter-map",
      )
      .flatMap((request) => z.array(WireRange).parse(request.payload.slice(1)))
    const synthesis = native.find(
      (request) =>
        z.object({ kind: z.string() }).parse(request.payload[0]).kind === "book-synthesis",
    )
    const verification = native.filter(
      (request) =>
        z.object({ kind: z.string() }).parse(request.payload[0]).kind === "original-verification",
    )
    const check = verification.at(-1)
    if (!synthesis || !check)
      throw new TypeError("Missing real synthesis/original verification request")
    const envelope = z
      .object({ maps: z.array(z.unknown()), groupIds: z.array(z.string()) })
      .parse(synthesis.payload[0])
    const mapSources = data.maps.flatMap(chapterFindings).flatMap((finding) => finding.sources)
    const findings = synthesisFindings(data.synthesis)
    return {
      control,
      required,
      normalization: fixture.normalization,
      edition: fixture.edition,
      analysis,
      requests,
      nativeTurns,
      verification,
      synthesisPayload: synthesis.payload,
      synthesisMaps: envelope.maps,
      synthesisGroupIds: envelope.groupIds,
      materializedMaps: data.maps,
      groupIds: data.groups.map((group) => group.id),
      mappingInputPaths: [...new Set(mapInputs.map((row) => row.resourcePath))],
      mappedSourcePaths: [...new Set(mapSources.map((span) => span.resourcePath))],
      findings,
      checkPayload: check.payload,
      audit: auditOriginalAssembly({
        normalization: fixture.normalization,
        payload: check.payload,
        required,
      }),
      structuralOutcome: {
        status: analysis.status,
        phase: data.phase,
        verification: data.verification,
        meaning: "mechanical acceptance under fixed scripted verdicts; never semantic correctness",
      },
    }
  } finally {
    await fixture.close()
  }
}
