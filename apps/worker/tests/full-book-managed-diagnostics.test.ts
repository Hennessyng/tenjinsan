import { FixtureDatabase } from "@reading-studio/storage/test-support"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { executionClock as clock } from "./full-book-execution-fixture.ts"
import { managedProcess } from "./full-book-managed-process-fixture.ts"

afterEach(() => vi.unstubAllEnvs())
it.each([
  { mode: "rpc-error", category: "rpc-rejection", stage: "turn-start-response", code: -32602 },
  { mode: "error-notification", category: "server-error", stage: "turn-event", code: "badRequest" },
  {
    mode: "malformed-ack",
    category: "invalid-response",
    stage: "turn-start-response",
    code: undefined,
  },
])(
  "preserves a safe $category classification without raw messages",
  async ({ mode, category, stage, code }) => {
    // Given a pinned-shape synthetic server error or malformed response with private sentinels.
    const f = managedProcess(mode)
    try {
      // When collection stops, then its counted unknown retains only bounded diagnostic classes.
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
        const diagnostic = z
          .object({
            diagnostic: z.object({
              category: z.literal(category),
              stage: z.literal(stage),
              code: z.union([z.string(), z.number()]).optional(),
            }),
          })
          .parse(JSON.parse(row.record_json)).diagnostic
        expect(diagnostic).toMatchObject({ category, stage })
        expect(diagnostic.code).toBe(code)
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
it("accepts the pinned benign reasoning-summary-part lifecycle event without treating it as a tool", async () => {
  // Given the public pinned ReasoningSummaryPartAddedNotification shape.
  const f = managedProcess("summary-part")
  try {
    // When a complete supported turn follows it, then only the validated final response is accepted.
    expect(
      await f.storage.fullBookManaged.run(f.grant.id, {
        signal: new AbortController().signal,
        now: () => clock.now,
      }),
    ).toMatchObject({ kind: "accepted" })
  } finally {
    f.cleanup()
  }
})
it("rejects a foreign turn in the same benign notification shape", async () => {
  // Given a foreign turn ID on an otherwise valid reasoning event.
  const f = managedProcess("foreign-summary")
  try {
    // When/Then it remains a charged unknown, never accepted or automatically retried.
    expect(
      await f.storage.fullBookManaged.run(f.grant.id, {
        signal: new AbortController().signal,
        now: () => clock.now,
      }),
    ).toMatchObject({ kind: "outcome-unknown" })
    expect(f.storage.fullBookExecution.receipts(f.budget.id)).toHaveLength(0)
  } finally {
    f.cleanup()
  }
})
