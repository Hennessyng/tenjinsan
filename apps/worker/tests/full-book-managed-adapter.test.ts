import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { FixtureDatabase as Database } from "@reading-studio/storage/test-support"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { executionClock as clock } from "./full-book-execution-fixture.ts"
import { managedProcess } from "./full-book-managed-process-fixture.ts"

afterEach(() => vi.unstubAllEnvs())
it("writes the exact owned app frames recorded for a new persisted full-book authorization", async () => {
  // Given an explicitly authorized fake managed account and opaque source markers.
  const f = managedProcess()
  try {
    // When the existing pinned RPC client drives the isolated experimental adapter.
    const result = await f.storage.fullBookManaged.run(f.grant.id, {
      signal: new AbortController().signal,
      now: () => clock.now,
    })
    // Then actual stdin bytes match the immutable managed record and strict routes were not certified.
    expect(result).toMatchObject({
      kind: "accepted",
      evidence: "experimental-app-bounded",
      buildKind: "fixture-not-live-evidence",
    })
    expect(
      JSON.parse(readFileSync(join(f.options.privateDataRoot, "before-write-ledger.json"), "utf8")),
    ).toEqual({ counted: 1 })
    expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(1)
    expect(f.storage.fullBookExecution.receipts(f.budget.id)).toHaveLength(1)
    const frames = readFileSync(f.capture, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => ({
        raw: `${line}\n`,
        data: z
          .object({ method: z.string(), params: z.unknown().optional() })
          .parse(JSON.parse(line)),
      }))
    const db = new Database(f.options.databasePath, { readonly: true })
    try {
      const row = z
        .object({ record_json: z.string() })
        .parse(db.prepare("SELECT record_json FROM full_book_managed_frames").get())
      const record = z
        .object({
          thread: z.object({ serialized: z.string(), sha256: z.string() }),
          turn: z.object({ serialized: z.string(), sha256: z.string() }),
        })
        .parse(JSON.parse(row.record_json))
      for (const [key, method] of [
        ["thread", "thread/start"],
        ["turn", "turn/start"],
      ] as const) {
        const frame = frames.find((frame) => frame.data.method === method)
        expect(frame?.raw).toBe(record[key].serialized)
        expect(createHash("sha256").update(record[key].serialized).digest("hex")).toBe(
          record[key].sha256,
        )
      }
    } finally {
      db.close()
    }
  } finally {
    f.cleanup()
  }
})

it.each([
  "overflow",
  "timeout",
  "partial",
  "tool",
  "foreign-thread",
  "halfwrite",
  "seen-close",
  "model-mismatch",
])(
  "retains one charged unknown and accepts no partial output after %s",
  async (mode) => {
    // Given a fake local process stopped or malformed at the selected boundary.
    const f = managedProcess(mode)
    try {
      // When collection or policy cannot establish one complete scoped terminal reply.
      expect(
        await f.storage.fullBookManaged.run(f.grant.id, {
          signal: new AbortController().signal,
          now: () => clock.now,
        }),
      ).toMatchObject({ kind: "outcome-unknown" })
      // Then no retry/refund/partial acceptance occurs, including half-delivered stdin.
      expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(1)
      expect(f.storage.fullBookExecution.attempts(f.budget.id)[0]).toMatchObject({
        state: "outcome_unknown",
        resolution: "awaiting-owner",
      })
      expect(f.storage.fullBookExecution.receipts(f.budget.id)).toHaveLength(0)
      if (mode === "halfwrite") expect(readFileSync(f.half).length).toBe(12)
      if (mode === "seen-close") expect(existsSync(f.capture)).toBe(true)
    } finally {
      f.cleanup()
    }
  },
  15_000,
)
