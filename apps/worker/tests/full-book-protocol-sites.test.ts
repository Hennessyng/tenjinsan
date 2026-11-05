import { FixtureDatabase } from "@reading-studio/storage/test-support"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { executionClock as clock } from "./full-book-execution-fixture.ts"
import { managedProcess } from "./full-book-managed-process-fixture.ts"

afterEach(() => vi.unstubAllEnvs())
it("accepts pinned text-only user input echoes without treating them as output or tools", async () => {
  // Given canonical input-item lifecycle notifications preceding the synthetic answer.
  const f = managedProcess("user-echo")
  try {
    // When/Then only the final agent answer is accepted, with one actual synthetic reservation.
    expect(
      await f.storage.fullBookManaged.run(f.grant.id, {
        signal: new AbortController().signal,
        now: () => clock.now,
      }),
    ).toMatchObject({ kind: "accepted" })
    expect(f.storage.fullBookExecution.receipts(f.budget.id)).toHaveLength(1)
  } finally {
    f.cleanup()
  }
})
it.each([
  ["legacy-event", "event-method"],
  ["unknown-method", "event-method"],
  ["bad-json", "json-invalid"],
  ["bad-envelope", "envelope-invalid"],
  ["client-request", "server-request"],
  ["early-close", "process-closed"],
  ["user-echo-foreign", "event-turn"],
  ["bad-usage", "usage-shape"],
  ["failed-turn", "terminal-status"],
  ["null-phase", "agent-phase"],
  ["ack-stall", "collection-timeout"],
  ["raw-overflow", "raw-overflow"],
  ["failed-ack", "ack-status"],
])(
  "retains failure site %s -> %s without arbitrary methods, payloads or paths",
  async (mode, site) => {
    // Given one isolated synthetic failure, not a real client or provider.
    const f = managedProcess(mode)
    try {
      // When the existing runner saves its failure, then the exact site survives storage.
      expect(
        await f.storage.fullBookManaged.run(f.grant.id, {
          signal: new AbortController().signal,
          now: () => clock.now,
        }),
      ).toMatchObject({ kind: "outcome-unknown" })
      const db = new FixtureDatabase(f.options.databasePath)
      try {
        const row = z
          .object({ record_json: z.string() })
          .parse(db.prepare("SELECT record_json FROM full_book_managed_failures").get())
        const failure = z
          .object({
            diagnostic: z.object({
              site: z.string(),
              transport: z
                .object({ nativeExitObserved: z.boolean(), nativeExitCode: z.number().nullable() })
                .optional(),
            }),
          })
          .parse(JSON.parse(row.record_json))
        expect(failure.diagnostic.site).toBe(site)
        if (mode === "early-close")
          expect(failure.diagnostic.transport).toMatchObject({
            nativeExitObserved: true,
            nativeExitCode: 7,
          })
        expect(row.record_json).not.toContain("SYNTHETIC_SECRET_NEVER_PERSIST")
        expect(row.record_json).not.toContain("SYNTHETIC_BOOK_NEVER_PERSIST")
      } finally {
        db.close()
      }
      expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(1)
      expect(f.storage.fullBookExecution.receipts(f.budget.id)).toHaveLength(0)
    } finally {
      f.cleanup()
    }
  },
)
