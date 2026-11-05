import { FixtureDatabase } from "@reading-studio/storage/test-support"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { executionClock as clock } from "./full-book-execution-fixture.ts"
import { managedProcess } from "./full-book-managed-process-fixture.ts"

afterEach(() => vi.unstubAllEnvs())
it.each(["queue-empty-pre-ack", "queue-empty-post-ack"])(
  "persists a truthful empty-id rejection snapshot from a queued process: %s",
  async (mode) => {
    // Given a real synthetic process emitting an empty id on either side of acknowledgement processing.
    const f = managedProcess(mode)
    try {
      // When/Then the durable failure names the envelope field and reports no observed turn or accepted answer.
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
        const saved = z
          .object({
            diagnostic: z.object({
              site: z.string(),
              observation: z.object({
                ack: z.string(),
                turnSeen: z.boolean(),
                fields: z.array(z.string()),
              }),
            }),
          })
          .parse(JSON.parse(row.record_json))
        expect(saved).toMatchObject({
          diagnostic: {
            site: "event-envelope",
            observation: {
              ack: mode === "queue-empty-post-ack" ? "received" : "pending",
              turnSeen: false,
              fields: ["turnId"],
            },
          },
        })
      } finally {
        db.close()
      }
      expect(f.storage.fullBookExecution.receipts(f.budget.id)).toHaveLength(0)
      expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(1)
    } finally {
      f.cleanup()
    }
  },
)
it.each(["queue-before-ack", "queue-after-ack"])(
  "handles the pinned thread-only queue invalidation without consuming payload or granting work: %s",
  async (mode) => {
    // Given a passive owned-thread invalidation emitted around acknowledgement on the source-proven listener path.
    const f = managedProcess(mode)
    try {
      // When/Then only the synthetic final answer is accepted; packet order is not asserted to identify the old live method.
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
  },
)
it("names rejected configuration metadata and reproduces the signature even when the ack was written first", async () => {
  // Given a schema-faithful source-conditional settings snapshot after a raw ack in the same output chunk.
  const f = managedProcess("metadata-settings-after-ack")
  try {
    // When/Then promise scheduling permits preAckEvents2 without proving server wire order or the lost live name.
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
      const saved = z
        .object({
          collectedBytes: z.number(),
          diagnostic: z.object({
            site: z.string(),
            observation: z.object({
              ack: z.string(),
              preAckEvents: z.number(),
              method: z.string(),
              turnSeen: z.boolean(),
              finalSeen: z.boolean(),
              terminalSeen: z.boolean(),
            }),
          }),
        })
        .parse(JSON.parse(row.record_json))
      expect(saved).toMatchObject({
        collectedBytes: 0,
        diagnostic: {
          site: "event-method",
          observation: {
            ack: "pending",
            preAckEvents: 2,
            method: "thread/settings/updated",
            turnSeen: false,
            finalSeen: false,
            terminalSeen: false,
          },
        },
      })
      expect(row.record_json).not.toContain("PRIVATE_PAYLOAD_SENTINEL")
    } finally {
      db.close()
    }
    expect(f.storage.fullBookExecution.receipts(f.budget.id)).toHaveLength(0)
  } finally {
    f.cleanup()
  }
})
it.each(["queue-foreign-thread", "queue-foreign-turn", "queue-invalid"])(
  "refuses scoped or shape-invalid metadata: %s",
  async (mode) => {
    // Given a foreign identity or extra payload under a public metadata method.
    const f = managedProcess(mode)
    try {
      // When/Then recognizing a name never bypasses correlation, shape policy or the normal charge ledger.
      expect(
        await f.storage.fullBookManaged.run(f.grant.id, {
          signal: new AbortController().signal,
          now: () => clock.now,
        }),
      ).toMatchObject({ kind: "outcome-unknown" })
      expect(f.storage.fullBookExecution.receipts(f.budget.id)).toHaveLength(0)
      expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(1)
    } finally {
      f.cleanup()
    }
  },
)
