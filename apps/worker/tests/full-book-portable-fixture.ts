import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  FullBookTestConsent,
  FullBookTestSession,
  planFullBookTest,
} from "@reading-studio/contracts"
import { openStorage } from "@reading-studio/storage"
import { completeSyntheticGraph } from "./full-book-complete-fixture.ts"
import { durableConsentFixture } from "./full-book-durable-fixture.ts"
import {
  admittedExecution,
  executionClock as clock,
  nextExecution,
  syntheticReplyMetadata,
} from "./full-book-execution-fixture.ts"
import { pluralMapOutput } from "./full-book-test-fixture.ts"

export function portableFixture(known = true) {
  const f = admittedExecution(),
    prepared = nextExecution(f)
  if (known) {
    f.storage.fullBookExecution.beforeWrite({
      lease: prepared.lease,
      attemptId: prepared.attempt.id,
      now: clock.now,
    })
    f.storage.fullBookExecution.receive({
      attemptId: prepared.attempt.id,
      dispatchKey: prepared.wire.dispatchKey,
      serialized: JSON.stringify(pluralMapOutput(f.consent.session)),
      usage: { kind: "known", inputTokens: 8, outputTokens: 4 },
      receivedAt: clock.now,
      metadata: syntheticReplyMetadata(prepared.wire),
    })
    f.storage.fullBookExecution.accept({
      lease: prepared.lease,
      attemptId: prepared.attempt.id,
      now: clock.now,
    })
  }
  f.storage.fullBookExecution.cancel(
    f.consent.id,
    "Explicit synthetic owner stop before portable export",
  )
  return { ...f, prepared }
}
export function portableDestination() {
  const root = mkdtempSync(join(tmpdir(), "full-book-restored-"))
  const options = { databasePath: join(root, "db.sqlite"), privateDataRoot: join(root, "private") },
    owner = "restored-reader"
  const storage = openStorage(options)
  storage.sources.createOwner(owner)
  storage.close()
  return {
    options,
    owner,
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}
export function completedPortableFixture() {
  const f = durableConsentFixture()
  const input = {
    ...f.consent.session.input,
    windows: f.consent.session.input.windows.flat().flatMap((span) => {
      const middle = Math.floor(span.originalFragment.length / 2)
      return [
        [{ ...span, end: middle, originalFragment: span.originalFragment.slice(0, middle) }],
        [{ ...span, start: middle, originalFragment: span.originalFragment.slice(middle) }],
      ]
    }),
  }
  const session = FullBookTestSession.parse({
    ...f.consent.session,
    input,
    plan: planFullBookTest(input),
  })
  const consent = FullBookTestConsent.parse({
    ...f.consent,
    session,
    sourceCeiling: session.plan.maxAttempts,
  })
  f.storage.fullBookConsent.approve(consent)
  completeSyntheticGraph(f.storage, consent)
  return { ...f, consent }
}
