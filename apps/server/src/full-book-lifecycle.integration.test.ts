import { FixtureDatabase } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { z } from "zod"
import { fullBookConsentInput, fullBookServerFixture } from "./testing/full-book-run-fixture.ts"

async function admitted(f: ReturnType<typeof fullBookServerFixture>) {
  const input = await fullBookConsentInput(f),
    response = await f.post("consent", input)
  expect(response.status).toBe(201)
  return input.submissionId
}
it("completes analysis-only work with actual managed frames and exact planned versus used counts", async () => {
  // Given explicit synthetic consent; no attempt is issued until Resume.
  const f = fullBookServerFixture()
  try {
    const id = await admitted(f)
    // When five explicit steps complete the needed graph, then unused nodes never become calls or downstream work.
    let response: Response | undefined
    for (let index = 0; index < 5; index++) {
      response = await f.post(`runs/${id}/resume`, {})
      expect(response.status, await response.clone().text()).toBe(200)
    }
    if (!response) throw new TypeError("Missing lifecycle reply")
    expect(await response.json()).toMatchObject({
      state: "complete",
      terminal: "analysis-only",
      plannedMaxAttempts: 14,
      usedAttempts: 5,
      notNeededNodes: 2,
      downstreamRevisions: false,
      readerContextChanged: false,
      native: { enabled: false },
    })
    expect(f.storage.counts()).toMatchObject({
      attempts: 5,
      questions: 0,
      answers: 0,
      briefs: 0,
      outlines: 0,
      lessons: 0,
    })
    const db = new FixtureDatabase(f.databasePath)
    try {
      expect(
        z
          .object({ n: z.literal(5) })
          .parse(db.prepare("SELECT COUNT(*) AS n FROM full_book_managed_frames").get()).n,
      ).toBe(5)
    } finally {
      db.close()
    }
    const exported = await f.app.request(`/api/full-book-test/${f.setup.id}/runs/${id}/export`, {
      headers: { host: "localhost:8787" },
    })
    expect(exported.status, await exported.clone().text()).toBe(200)
    expect(
      z.object({ authority: z.literal("historical-audit-only") }).parse(await exported.json())
        .authority,
    ).toBe("historical-audit-only")
  } finally {
    f.cleanup()
  }
})
it("accepts a received reply without resending or charging another attempt", async () => {
  // Given one durable reply whose acceptance was interrupted.
  const f = fullBookServerFixture()
  try {
    const id = await admitted(f)
    f.setMode("received")
    expect(await (await f.post(`runs/${id}/resume`, {})).json()).toMatchObject({
      state: "received",
      usedAttempts: 1,
    })
    // When Resume accepts that stored reply, then count remains one and no second frame is issued.
    expect(await (await f.post(`runs/${id}/resume`, {})).json()).toMatchObject({
      state: "paused",
      usedAttempts: 1,
      completedNodes: 1,
    })
  } finally {
    f.cleanup()
  }
})
it("counts bootstrap failure and requires a separate charged-retry decision before Resume", async () => {
  // Given an actual recorded bootstrap failure, before any owned turn exists.
  const f = fullBookServerFixture()
  try {
    const id = await admitted(f)
    f.setMode("bootstrap-failure")
    const unknown = z
      .object({
        state: z.literal("unknown"),
        usedAttempts: z.literal(1),
        unknownAttempts: z.array(z.string()).length(1),
      })
      .parse(await (await f.post(`runs/${id}/resume`, {})).json())
    const db = new FixtureDatabase(f.databasePath)
    try {
      expect(db.prepare("SELECT COUNT(*) AS n FROM full_book_managed_threads").get()).toEqual({
        n: 1,
      })
      expect(db.prepare("SELECT COUNT(*) AS n FROM full_book_managed_frames").get()).toEqual({
        n: 0,
      })
    } finally {
      db.close()
    }
    // When an owner approves retry, then no new call is made until the next explicit Resume.
    expect((await f.post(`runs/${id}/resume`, {})).status).toBe(409)
    const decision = await f.post(`runs/${id}/decision`, {
      attemptId: unknown.unknownAttempts[0],
      decision: "retry",
      acknowledgeUnknownCharge: true,
    })
    expect(await decision.json()).toMatchObject({ state: "paused", usedAttempts: 1 })
    f.setMode("complete")
    expect(await (await f.post(`runs/${id}/resume`, {})).json()).toMatchObject({
      state: "paused",
      usedAttempts: 2,
    })
  } finally {
    f.cleanup()
  }
})
it("revokes consent and stops pending owned frames while retaining unknown charges", async () => {
  // Given an observed running synthetic turn and its counted owned frame.
  const f = fullBookServerFixture()
  try {
    const id = await admitted(f)
    f.setMode("stall")
    const pending = f.post(`runs/${id}/resume`, {})
    await f.whenStarted()
    // When Cancel revokes authority, then late processing cannot make another turn or refund the issued attempt.
    expect(await (await f.post(`runs/${id}/cancel`, {})).json()).toMatchObject({
      state: "cancelled",
      revoked: true,
      usedAttempts: 1,
    })
    expect((await pending).status).toBe(200)
    expect((await f.post(`runs/${id}/resume`, {})).status).toBe(409)
    expect(
      f.storage.fullBookConsent.preview(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ),
    ).toMatchObject({ spent: 1, held: 0 })
  } finally {
    f.cleanup()
  }
})
