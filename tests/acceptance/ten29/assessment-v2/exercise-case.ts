import { randomUUID } from "node:crypto"
import { synthesisFindings } from "@reading-studio/contracts"
import { legacyLocalReservationBytes, ProviderReceipt } from "@reading-studio/providers"
import { openStorage } from "@reading-studio/storage"
import { z } from "zod"
import { bookFixtureTurns } from "../../../../apps/worker/tests/book-map-route-fixture.ts"
import { corpus, type Format } from "../corpus-support.ts"
import { exerciseNormalV4 } from "../normal-v4-fixture.ts"
import { persistedCorpus } from "../persisted-corpus.ts"
import { WireRange, wirePayload } from "../processing-evidence.ts"
import type { CandidateBody } from "./control-types.ts"
import { familyNarratives } from "./controls.ts"
import { AssessmentScriptAdapter } from "./script-adapter.ts"
import { canonicalText, hashText, projectSource } from "./source-projection.ts"
export async function exerciseAssessmentCase(candidate: CandidateBody, format: Format) {
  const family = corpus.find((row) => row.id === candidate.family),
    narrative = familyNarratives.find((row) => row.family === candidate.family)
  if (!family || !narrative) throw new TypeError("Missing frozen source/narrative")
  const fixture = await persistedCorpus(family, format, { draftOnly: true })
  try {
    const projection = projectSource(family, fixture.normalization)
    const adapter = new AssessmentScriptAdapter({ candidate, narrative, source: projection })
    const result = await exerciseNormalV4(fixture, adapter)
    if (result.kind !== "processed")
      throw new TypeError(`Candidate refused before consent: ${JSON.stringify(result.review)}`)
    const data = result.analysis.wholeBook
    if (result.analysis.status !== "successful" || !data?.synthesis)
      throw new TypeError(
        `Scripted pipeline did not persist completion: ${JSON.stringify({ analysis: result.analysis, jobs: result.jobs })}`,
      )
    const requests = adapter.requests.map((request) => ({
      hash: hashText(request.prompt),
      payload: wirePayload(request.prompt),
      planningBytes: legacyLocalReservationBytes("chatgpt-subscription", request),
    }))
    const native = z
      .array(z.object({ input: z.array(z.object({ text: z.string() })) }))
      .parse(bookFixtureTurns(fixture))
    if (native.length !== requests.length) throw new TypeError("Missing native scripted turns")
    for (const [index, turn] of native.entries())
      if (
        JSON.stringify(wirePayload(turn.input[0]?.text ?? "")) !==
        JSON.stringify(requests[index]?.payload)
      )
        throw new TypeError("Authored/native assembly differs")
    const mapRanges = requests
      .filter((row) => z.object({ kind: z.string() }).parse(row.payload[0]).kind === "chapter-map")
      .flatMap((row) => z.array(WireRange).parse(row.payload.slice(1)))
    if (canonicalText(mapRanges.map((range) => range.text).join(" ")) !== projection.canonicalText)
      throw new TypeError("Mapping did not process ordered original text")
    const receipts = result.jobs.flatMap((job) =>
      fixture.storage.execution.listAttempts(job.runId).map((attempt) => {
        const body = fixture.storage.execution.getAttemptReceipt(attempt.id)
        if (!body) throw new TypeError("Completed job has no durable receipt")
        return {
          jobId: job.id,
          attempt,
          receiptSha256: hashText(new TextDecoder().decode(body)),
          receipt: ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body))),
        }
      }),
    )
    if (receipts.length !== requests.length || result.jobs.some((job) => job.state !== "completed"))
      throw new TypeError("Incomplete job/receipt accounting")
    const reserve = result.setup.batchedVerificationReserve
    if (
      !reserve ||
      receipts.length > reserve.plannedAttempts - reserve.reservedLaterAttempts ||
      receipts.length + reserve.reservedLaterAttempts > reserve.cap - reserve.used
    )
      throw new TypeError("Existing signed budget exceeded")
    if (
      requests.some((request) => request.planningBytes > 32000) ||
      receipts.some((row) => (row.receipt.appWire?.bytes ?? Infinity) > 32000)
    )
      throw new TypeError("Existing request-byte capacity exceeded")
    const stored = fixture.storage.workflow.getAnalysis(result.analysis.id)
    const reopened = openStorage({
      databasePath: fixture.databasePath,
      privateDataRoot: fixture.privateDataRoot,
    })
    let reopenedHash: string
    try {
      reopenedHash = hashText(JSON.stringify(reopened.workflow.getAnalysis(result.analysis.id)))
    } finally {
      reopened.close()
    }
    const storedHash = hashText(JSON.stringify(stored))
    if (storedHash !== hashText(JSON.stringify(result.analysis)) || storedHash !== reopenedHash)
      throw new TypeError("Stored/reopened analysis differs")
    for (const finding of synthesisFindings(data.synthesis))
      for (const span of finding.sources) {
        const resource = fixture.normalization.resources.find(
          (row) => row.path === span.resourcePath,
        )
        const block =
          resource?.status === "included"
            ? resource.blocks.find((row) => row.id === span.blockId)
            : undefined
        if (!block || block.text.slice(span.start, span.end) !== span.originalFragment)
          throw new TypeError("Persisted citation is not exact original text")
      }
    return {
      runId: randomUUID(),
      audience: "AUTHOR/TECHNICAL ONLY; not an assessor packet",
      candidate,
      format,
      projection,
      setup: result.setup,
      grant: fixture.storage.sources.getGrant(result.grantId),
      analysis: stored,
      persistedSha256: storedHash,
      reopenedSha256: reopenedHash,
      jobs: result.jobs,
      requests,
      receipts,
      nativeTurns: native.length,
      counts: fixture.storage.counts(),
      mechanicalOutcome:
        "successful under fixed all-supported/no-omission script; NOT semantic acceptance",
      humanAssessment: "NOT STARTED",
      liveCalls: false,
    }
  } finally {
    await fixture.close()
  }
}
