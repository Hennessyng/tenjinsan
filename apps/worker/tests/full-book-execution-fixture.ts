import { randomUUID } from "node:crypto"
import {
  FullBookTestConsent,
  FullBookTestSession,
  planFullBookTest,
} from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"
import { durableConsentFixture } from "./full-book-durable-fixture.ts"

export const executionClock = {
  now: "2026-10-31T00:00:00.000Z",
  expiresAt: "2026-10-31T00:01:00.000Z",
  later: "2026-10-31T00:02:00.000Z",
  laterExpiry: "2026-10-31T00:03:00.000Z",
} as const
export function admittedExecution() {
  const fixture = durableConsentFixture()
  fixture.storage.fullBookConsent.approve(fixture.consent)
  return fixture
}
export function admittedDirectExecution(maxFindings = 12) {
  const f = durableConsentFixture(),
    input = {
      ...f.consent.session.input,
      hierarchyPolicy: "direct-children-2",
      policy: { ...f.consent.session.input.policy, maxFindings },
    }
  const session = FullBookTestSession.parse({
      ...f.consent.session,
      input,
      plan: planFullBookTest(input),
    }),
    consent = FullBookTestConsent.parse({ ...f.consent, session })
  f.storage.fullBookConsent.approve(consent)
  return { ...f, consent }
}
export function nextExecution(fixture: ReturnType<typeof durableConsentFixture>, later = false) {
  const now = later ? executionClock.later : executionClock.now
  const lease = fixture.storage.fullBookExecution.claim({
    consentId: fixture.consent.id,
    token: randomUUID(),
    now,
    expiresAt: later ? executionClock.laterExpiry : executionClock.expiresAt,
  })
  if (!lease) throw new TypeError("Missing synthetic execution claim")
  const reserved = fixture.storage.fullBookExecution.reserve({
    lease,
    now,
    threadId: "synthetic-thread",
    rpcId: fixture.storage.fullBookExecution.attempts(fixture.consent.id).length + 1,
  })
  return { lease, ...reserved }
}
export function syntheticReplyMetadata(
  wire: ReturnType<Storage["fullBookExecution"]["reserve"]>["wire"],
  terminal: "completed" | "failed" | "interrupted" = "completed",
) {
  return {
    transport: "synthetic-only-no-native-entry",
    threadId: wire.threadId,
    requestId: wire.rpcId,
    wireHash: wire.hash,
    targetHash: wire.targetHash,
    turnId: `synthetic-${wire.rpcId}`,
    terminal,
  }
}
