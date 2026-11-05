import { randomUUID } from "node:crypto"
import {
  assertNever,
  FullBookFinding,
  FullBookTestConsent,
  FullBookTestSession,
  fullBookTestRequest,
  planFullBookTest,
} from "@reading-studio/contracts"
import { openStorage } from "@reading-studio/storage"
import { FixtureDatabase as Database } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { z } from "zod"
import { durableConsentFixture } from "./full-book-durable-fixture.ts"
import {
  executionClock as clock,
  nextExecution,
  syntheticReplyMetadata,
} from "./full-book-execution-fixture.ts"
import { pluralMapOutput, reductionOutput } from "./full-book-test-fixture.ts"

it.each([1, 2])(
  "durably completes the fixed graph with source split factor %i and releases only unused repair holds",
  (factor) => {
    // Given an authoritative source and either one window or a four-window, two-level reduction tree.
    const f = durableConsentFixture()
    const input = {
      ...f.consent.session.input,
      windows:
        factor === 1
          ? f.consent.session.input.windows
          : f.consent.session.input.windows.flat().flatMap((span) => {
              const middle = Math.floor(span.originalFragment.length / 2)
              return [
                [
                  {
                    ...span,
                    end: middle,
                    originalFragment: span.originalFragment.slice(0, middle),
                  },
                ],
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
      sourceCeiling: Math.max(f.consent.sourceCeiling, session.plan.maxAttempts),
    })
    f.storage.fullBookConsent.approve(consent)
    const expectedStages = factor === 1 ? 7 : 21
    try {
      for (const node of session.plan.nodes) {
        const receipts = f.storage.fullBookExecution.receipts(f.consent.id),
          built = fullBookTestRequest(session, receipts)
        const prepared = nextExecution(f)
        f.storage.fullBookExecution.beforeWrite({
          lease: prepared.lease,
          attemptId: prepared.attempt.id,
          now: clock.now,
        })
        let output: unknown
        switch (node.kind) {
          case "map":
            output = {
              ...pluralMapOutput(session, node.window ?? -1),
              targetHash: built.target.hash,
            }
            break
          case "reduce":
            output = reductionOutput(session, receipts)
            break
          case "map-check":
          case "final-check":
          case "citation-check": {
            const body = z
              .tuple([z.unknown(), z.object({ findings: z.array(FullBookFinding) })])
              .parse(
                JSON.parse(built.request.prompt.slice(built.request.prompt.indexOf("\n") + 1)),
              )[1]
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
        // When each exact reply is recorded and accepted through storage's shared validators.
        f.storage.fullBookExecution.receive({
          attemptId: prepared.attempt.id,
          dispatchKey: prepared.wire.dispatchKey,
          serialized: JSON.stringify(output),
          usage: { kind: "known", inputTokens: 10, outputTokens: 5 },
          receivedAt: clock.now,
          metadata: syntheticReplyMetadata(prepared.wire),
        })
        expect(
          f.storage.fullBookExecution.accept({
            lease: prepared.lease,
            attemptId: prepared.attempt.id,
            now: clock.now,
          }).kind,
        ).toBe("accepted")
      }
      // Then the whole finite graph survives reopen, with only actual attempts spent and no remaining holds.
      expect(f.storage.fullBookExecution.receipts(f.consent.id)).toHaveLength(expectedStages)
      expect(Object.isFrozen(f.storage.fullBookExecution.receipts(f.consent.id))).toBe(true)
      expect(Object.isFrozen(f.storage.fullBookExecution.attempts(f.consent.id))).toBe(true)
      expect(
        f.storage.fullBookConsent.commitments(
          f.consent.ownerId,
          f.consent.session.input.normalization.editionHash,
        ),
      ).toEqual({ spent: expectedStages, held: 0 })
      expect(
        f.storage.fullBookExecution.claim({
          consentId: f.consent.id,
          token: randomUUID(),
          now: clock.now,
          expiresAt: clock.expiresAt,
        }),
      ).toBeNull()
      const reopened = openStorage(f.options)
      try {
        expect(reopened.fullBookExecution.receipts(f.consent.id)).toHaveLength(expectedStages)
      } finally {
        reopened.close()
      }
      const db = new Database(f.options.databasePath)
      try {
        expect(() =>
          db.prepare("UPDATE full_book_output_receipts SET record_json='{}'").run(),
        ).toThrow("immutable")
      } finally {
        db.close()
      }
    } finally {
      f.cleanup()
    }
  },
)
