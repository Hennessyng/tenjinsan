import { COVERAGE_VERIFICATION_VERSION, synthesisFindings } from "@reading-studio/contracts"
import { z } from "zod"
import { bookFixtureTurns } from "../../../apps/worker/tests/book-map-route-fixture.ts"
import { wholeBookWorker } from "../../../apps/worker/tests/whole-book-fixture.ts"
import { epubEntries, zipFixture } from "../../../packages/ingestion/tests/fixtures.ts"
import { escapeXml, extract } from "./corpus-support.ts"
import { CoverageControlAdapter, type CoverageState } from "./coverage-control-adapter.ts"
import { ContextControlAdapter } from "./evaluator-context-adapter.ts"
import type { ContextControl } from "./evaluator-controls-v2.ts"
import { auditOriginalAssembly } from "./evaluator-evidence.ts"
import { auditRequiredPassages, type RequiredPassage } from "./evaluator-passages-v2.ts"
import { persistedSource } from "./persisted-source.ts"
import { WireRange, wirePayload } from "./processing-evidence.ts"

export async function exerciseContextControl(
  control: ContextControl,
  coverageState?: CoverageState,
) {
  const bytes = await zipFixture([
    ...epubEntries.filter(
      (entry) => entry.name === "mimetype" || entry.name === "META-INF/container.xml",
    ),
    {
      name: "book/package.opf",
      text: `<package xmlns="http://www.idpf.org/2007/opf"><manifest>${control.resources.map((_, index) => `<item id="c${index}" href="${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${control.resources.map((resource, index) => `<itemref idref="c${index}"${resource.supplementary ? ' linear="no"' : ""}/>`).join("")}</spine></package>`,
    },
    ...control.resources.map((resource, index) => ({
      name: `book/${index + 1}.xhtml`,
      text: `<html xmlns="http://www.w3.org/1999/xhtml"><body>${resource.title ? `<h1>${escapeXml(resource.title)}</h1>` : ""}${resource.paragraphs.map((text) => `<p>${escapeXml(text)}</p>`).join("")}</body></html>`,
    })),
  ])
  const extracted = await extract(bytes, "epub")
  const blocks = extracted.normalization.resources.flatMap((resource) =>
    resource.status === "included"
      ? resource.blocks.map((block) => ({ resourcePath: resource.path, ...block }))
      : [],
  )
  const expected = control.resources.flatMap((resource) => [
    ...(resource.title ? [resource.title] : []),
    ...resource.paragraphs,
  ])
  if (
    JSON.stringify(blocks.map((block) => block.text)) !== JSON.stringify(expected) ||
    extracted.normalization.coverage !== "complete"
  )
    throw new TypeError("New authored fixture failed exact extraction gate")
  const required: RequiredPassage[] = control.required.map((reference) => {
    const matches = blocks.filter((block) => block.text.includes(reference.text))
    const block = matches[0]
    if (!block || matches.length !== 1)
      throw new TypeError("Required authored passage is not unique")
    const start = block.text.indexOf(reference.text)
    return {
      ...reference,
      resourcePath: block.resourcePath,
      blockId: block.id,
      start,
      end: start + reference.text.length,
    }
  })
  const fixture = await persistedSource(
    bytes,
    extracted,
    coverageState ? { synthesisVersion: COVERAGE_VERIFICATION_VERSION } : {},
  )
  try {
    const authored = new ContextControlAdapter(control)
    const adapter = coverageState ? new CoverageControlAdapter(authored, coverageState) : authored
    const run = wholeBookWorker(fixture, adapter)
    let analysis = run.pipeline.prepare("setup-whole", "grant-whole")
    for (let step = 0; step < 32; step++) {
      if ((await run.worker.runNext()).kind === "idle") break
      analysis = run.pipeline.prepare("setup-whole", "grant-whole")
    }
    const data = analysis.wholeBook
    if (!data?.synthesis)
      throw new TypeError(
        `Fixture did not reach synthesis: ${JSON.stringify(fixture.storage.execution.listSetupJobs("setup-whole").map((job) => ({ state: job.state, error: job.error })))}`,
      )
    const turns = z
      .array(z.object({ input: z.array(z.object({ text: z.string() })) }))
      .parse(bookFixtureTurns(fixture))
    if (turns.length !== adapter.requests.length)
      throw new TypeError("Prepared/native request count mismatch")
    const payloads = turns.map((turn, index) => {
      const text = turn.input[0]?.text
      if (!text) throw new TypeError("Missing actual native body")
      const payload = wirePayload(text)
      if (
        JSON.stringify(payload) !==
        JSON.stringify(wirePayload(adapter.requests[index]?.prompt ?? ""))
      )
        throw new TypeError("Prepared/native payload mismatch")
      return payload
    })
    const kind = (payload: readonly unknown[]) =>
      z.object({ kind: z.string() }).parse(payload[0]).kind
    const mapPayloads = payloads.filter((payload) => kind(payload) === "chapter-map")
    const synthesisPayload = payloads.find((payload) => kind(payload) === "book-synthesis")
    if (!synthesisPayload) throw new TypeError("Missing native synthesis")
    const targetIds = synthesisFindings(data.synthesis)
      .map((finding) => finding.id)
      .sort()
    const checks = payloads
      .filter((payload) => kind(payload) === "original-verification")
      .filter((payload) => {
        const envelope = z
          .object({ interpretations: z.array(z.object({ id: z.string() })) })
          .parse(payload[0])
        return (
          JSON.stringify(envelope.interpretations.map((finding) => finding.id).sort()) ===
          JSON.stringify(targetIds)
        )
      })
    if (checks.length !== 1) throw new TypeError("Synthesis verifier target identity is not unique")
    const checkPayload = checks[0]
    if (!checkPayload) throw new TypeError("Missing bound synthesis verification")
    const mapRows = mapPayloads.flatMap((payload) => z.array(WireRange).parse(payload.slice(1)))
    const allOriginals = auditOriginalAssembly({
      normalization: extracted.normalization,
      payload: [{ kind: "aggregate-observed-map-inputs" }, ...mapRows],
      required: blocks.map((block, index) => ({
        part: `block-${index}`,
        resourcePath: block.resourcePath,
        blockId: block.id,
        text: block.text,
      })),
    })
    const synthesis = z
      .object({ maps: z.array(z.unknown()), groupIds: z.array(z.string()) })
      .parse(synthesisPayload[0])
    return {
      control,
      required,
      normalization: extracted.normalization,
      analysis,
      payloads,
      mapPayloads,
      synthesisPayload,
      checkPayload,
      synthesisMaps: synthesis.maps,
      sourceMaps: data.maps,
      synthesisGroupIds: synthesis.groupIds,
      groupIds: data.groups.map((group) => group.id),
      allOriginals,
      audit: auditRequiredPassages({
        normalization: extracted.normalization,
        payload: checkPayload,
        required,
      }),
      structuralOutcome: {
        status: analysis.status,
        phase: data.phase,
        meaning: "scripted protocol status, never semantic truth",
      },
    }
  } finally {
    await fixture.close()
  }
}
