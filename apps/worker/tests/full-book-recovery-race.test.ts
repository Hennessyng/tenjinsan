import { type ChildProcess, fork } from "node:child_process"
import { expect, it, vi } from "vitest"
import { z } from "zod"
import { executionClock as clock } from "./full-book-execution-fixture.ts"
import { recoveryFixture } from "./full-book-recovery-fixture.ts"

it("admits only one recovery claim and charge across two simultaneous OS processes", async () => {
  // Given an admitted one-shot in a disposable fixture and two independent storage processes.
  const f = recoveryFixture(),
    children: ChildProcess[] = []
  let ready = 0
  try {
    f.storage.fullBookRecovery.approve(f.amendment)
    const results = [0, 1].map(
      () =>
        new Promise<boolean>((resolve, reject) => {
          const child = fork(
            new URL("./full-book-recovery-race.process.ts", import.meta.url),
            [
              f.options.databasePath,
              f.options.privateDataRoot,
              f.budget.id,
              f.grant.id,
              clock.now,
              clock.expiresAt,
            ],
            {
              execArgv: ["--experimental-transform-types", "--disable-warning=ExperimentalWarning"],
              stdio: ["ignore", "ignore", "ignore", "ipc"],
            },
          )
          children.push(child)
          let claimed: boolean | null = null
          child.on("error", reject)
          child.on("message", (raw) => {
            const event = z
              .discriminatedUnion("stage", [
                z.object({ stage: z.literal("ready") }),
                z.object({ stage: z.literal("result"), claimed: z.boolean() }),
                z.object({ stage: z.literal("error"), category: z.string() }),
              ])
              .safeParse(raw)
            if (!event.success) {
              reject(new TypeError("Invalid fixture event"))
              return
            }
            switch (event.data.stage) {
              case "ready":
                if (++ready === 2) for (const participant of children) participant.send("start")
                break
              case "result":
                claimed = event.data.claimed
                break
              case "error":
                reject(new TypeError("Isolated fixture failed"))
                break
            }
          })
          child.once("close", (code) => {
            if (code === 0 && claimed !== null) resolve(claimed)
            else reject(new TypeError("Isolated fixture exited without receipt"))
          })
        }),
    )
    // When both cross the start barrier, then SQLite fencing/consumption charges only ordinal three once.
    expect((await Promise.all(results)).filter(Boolean)).toHaveLength(1)
    expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(3)
    expect(
      f.storage.fullBookConsent.commitments(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ),
    ).toEqual({ spent: 3, held: f.budget.session.plan.maxAttempts - 2 })
  } finally {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        const closed = new Promise<void>((resolve) => child.once("close", () => resolve()))
        child.kill("SIGKILL")
        await closed
      }
    vi.unstubAllEnvs()
    f.cleanup()
  }
})
