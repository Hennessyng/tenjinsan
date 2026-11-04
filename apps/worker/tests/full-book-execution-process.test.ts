import { type ChildProcess, fork } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { assertNever } from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { z } from "zod"
import { admittedExecution, executionClock as clock } from "./full-book-execution-fixture.ts"

const Message = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready") }),
  z.object({ kind: z.literal("result"), claimed: z.boolean(), attemptId: z.string().optional() }),
  z.object({ kind: z.literal("checkpoint"), boundary: z.string(), attemptId: z.string() }),
])
function waitMessage(child: ChildProcess) {
  return new Promise<z.infer<typeof Message>>((resolve, reject) => {
    const onExit = () => {
      reject(new TypeError("Synthetic worker exited before its checkpoint"))
    }
    child.once("exit", onExit)
    child.once("error", reject)
    child.once("message", (value) => {
      child.off("exit", onExit)
      resolve(Message.parse(value))
    })
  })
}
function launch(f: ReturnType<typeof admittedExecution>, mode: string) {
  const child = fork(
    fileURLToPath(new URL("./full-book-execution-process.ts", import.meta.url)),
    [JSON.stringify(f.options), f.consent.id, mode],
    { execArgv: ["--experimental-transform-types"], stdio: ["ignore", "ignore", "pipe", "ipc"] },
  )
  child.stderr?.pipe(process.stderr, { end: false })
  return child
}
async function finish(child: ChildProcess, kill = false) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, "exit")
  if (kill) child.kill("SIGKILL")
  await exited
}

it("admits exactly one canonical claim and one charge across actually contending processes", async () => {
  // Given two OS processes waiting at the same claim boundary against one SQLite library.
  const f = admittedExecution(),
    children = [launch(f, "race"), launch(f, "race")]
  try {
    expect(await Promise.all(children.map(waitMessage))).toEqual([
      { kind: "ready" },
      { kind: "ready" },
    ])
    const messages = children.map(waitMessage)
    // When both processes are released concurrently.
    for (const child of children) child.send("start")
    const results = await Promise.all(messages)
    await Promise.all(children.map((child) => finish(child)))
    // Then exactly one process owns a charged job; no extra source pool was created.
    expect(results.filter((result) => result.kind === "result" && result.claimed)).toHaveLength(1)
    expect(f.storage.fullBookExecution.attempts(f.consent.id)).toHaveLength(1)
    expect(
      f.storage.fullBookConsent.commitments(
        f.consent.ownerId,
        f.consent.session.input.normalization.editionHash,
      ).spent,
    ).toBe(1)
  } finally {
    await Promise.all(children.map((child) => finish(child, true)))
    f.cleanup()
  }
}, 15_000)

it.each(["before-write", "received"] as const)(
  "kills and reopens the real worker process at %s without losing charges or received usage",
  async (boundary) => {
    // Given a process stopped at the selected durable boundary, with no native transport enabled.
    const f = admittedExecution(),
      child = launch(f, boundary)
    try {
      expect(await waitMessage(child)).toEqual({ kind: "ready" })
      const checkpoint = waitMessage(child)
      child.send("start")
      const stopped = await checkpoint
      expect(stopped.kind).toBe("checkpoint")
      // When that exact worker is killed and another instance recovers its expired lease.
      await finish(child, true)
      f.storage.fullBookExecution.recover({ consentId: f.consent.id, now: clock.later })
      const attempt = f.storage.fullBookExecution.attempts(f.consent.id)[0]
      // Then a lost write stays charged/unknown, while a seen reply retains usage and resumes acceptance without resend.
      switch (boundary) {
        case "before-write":
          expect(attempt).toMatchObject({ state: "outcome_unknown", resolution: "awaiting-owner" })
          break
        case "received": {
          expect(attempt).toMatchObject({
            state: "response-received",
            usage: { kind: "known", inputTokens: 11, outputTokens: 6 },
          })
          const lease = f.storage.fullBookExecution.claim({
            consentId: f.consent.id,
            token: randomUUID(),
            now: clock.later,
            expiresAt: clock.laterExpiry,
          })
          if (!lease || !attempt) throw new TypeError("Missing recovered receipt claim")
          expect(() =>
            f.storage.fullBookExecution.reserve({
              lease,
              now: clock.later,
              threadId: "synthetic-thread",
              rpcId: 2,
            }),
          ).toThrow()
          expect(
            f.storage.fullBookExecution.accept({ lease, attemptId: attempt.id, now: clock.later })
              .kind,
          ).toBe("accepted")
          expect(f.storage.fullBookExecution.receipts(f.consent.id)).toHaveLength(1)
          break
        }
        default:
          assertNever(boundary)
      }
      expect(f.storage.fullBookExecution.attempts(f.consent.id)).toHaveLength(1)
    } finally {
      await finish(child, true)
      f.cleanup()
    }
  },
  15_000,
)
