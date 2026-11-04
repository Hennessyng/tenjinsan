import { randomUUID } from "node:crypto"
import {
  assertNever,
  FullBookFinding,
  type FullBookTestConsent,
  fullBookTestRequest,
} from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"
import { z } from "zod"
import { executionClock as clock, syntheticReplyMetadata } from "./full-book-execution-fixture.ts"
import { pluralMapOutput, reductionOutput } from "./full-book-test-fixture.ts"

export function completeSyntheticGraph(storage: Storage, consent: FullBookTestConsent) {
  for (const node of consent.session.plan.nodes) {
    const receipts = storage.fullBookExecution.receipts(consent.id),
      built = fullBookTestRequest(consent.session, receipts)
    const lease = storage.fullBookExecution.claim({
      consentId: consent.id,
      token: randomUUID(),
      now: clock.now,
      expiresAt: clock.expiresAt,
    })
    if (!lease) throw new TypeError("Missing synthetic graph claim")
    const prepared = storage.fullBookExecution.reserve({
      lease,
      now: clock.now,
      threadId: "synthetic-thread",
      rpcId: receipts.length + 1,
    })
    storage.fullBookExecution.beforeWrite({ lease, attemptId: prepared.attempt.id, now: clock.now })
    let output: unknown
    switch (node.kind) {
      case "map":
        output = {
          ...pluralMapOutput(consent.session, node.window ?? -1),
          targetHash: built.target.hash,
        }
        break
      case "reduce":
        output = reductionOutput(consent.session, receipts)
        break
      case "map-check":
      case "final-check":
      case "citation-check": {
        const body = z
          .tuple([z.unknown(), z.object({ findings: z.array(FullBookFinding) })])
          .parse(JSON.parse(built.request.prompt.slice(built.request.prompt.indexOf("\n") + 1)))[1]
        output = {
          kind: "verification",
          targetHash: built.target.hash,
          decisions: body.findings.map((finding) => ({
            findingId: finding.id,
            verdict: "supported",
            explanation: "Controlled synthetic verdict, not semantic proof.",
          })),
          materialCoverage:
            node.kind === "map-check"
              ? { verdict: "none", explanation: "Controlled synthetic coverage." }
              : null,
        }
        break
      }
      default:
        assertNever(node.kind)
    }
    storage.fullBookExecution.receive({
      attemptId: prepared.attempt.id,
      dispatchKey: prepared.wire.dispatchKey,
      serialized: JSON.stringify(output),
      usage: { kind: "known", inputTokens: 10, outputTokens: 5 },
      receivedAt: clock.now,
      metadata: syntheticReplyMetadata(prepared.wire),
    })
    if (
      storage.fullBookExecution.accept({ lease, attemptId: prepared.attempt.id, now: clock.now })
        .kind !== "accepted"
    )
      throw new TypeError("Synthetic graph was not accepted")
  }
}
