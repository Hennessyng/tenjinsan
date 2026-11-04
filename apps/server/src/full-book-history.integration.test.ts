import { expect, it } from "vitest"
import { z } from "zod"
import { createApp } from "./app.ts"
import { fullBookConsentInput, fullBookServerFixture } from "./testing/full-book-run-fixture.ts"

async function admit(f: ReturnType<typeof fullBookServerFixture>) {
  const input = await fullBookConsentInput(f)
  expect((await f.post("consent", input)).status).toBe(201)
  return input.submissionId
}
it("retains unknown received usage and binds it into the next exact consent acknowledgement", async () => {
  // Given a received reply whose provider usage remains unknown, not zero.
  const f = fullBookServerFixture()
  try {
    const id = await admit(f)
    f.setMode("received-unknown-usage")
    const response = await f.post(`runs/${id}/resume`, {})
    expect(await response.json()).toMatchObject({
      state: "received",
      usedAttempts: 1,
      usage: [{ usage: { kind: "unknown" } }],
    })
    await f.post(`runs/${id}/cancel`, {})
    // When a new review is prepared, then its immutable budget proof includes the prior unknown-usage report.
    const next = await fullBookConsentInput(f)
    expect(next.acknowledgements).toMatchObject({ priorSpent: 1, priorUsageUnknown: 1 })
  } finally {
    f.cleanup()
  }
})
it("keeps stale history readable while refusing current execution and preserving revocation", async () => {
  // Given a recorded consent whose stored destination fence becomes stale.
  const f = fullBookServerFixture()
  try {
    const id = await admit(f)
    f.storage.subscriptionConnections.disconnect(
      f.budget.session.destination.installationId,
      "chatgpt-subscription",
    )
    // When the owner reads and cancels stale history, then no new attempt is issued and the original record remains exportable.
    const state = await f.app.request(`/api/full-book-test/${f.setup.id}/runs/${id}`, {
      headers: { host: "localhost:8787" },
    })
    expect(state.status).toBe(200)
    expect(await state.json()).toMatchObject({
      reviewRequired: true,
      canResume: false,
      usedAttempts: 0,
    })
    expect((await f.post(`runs/${id}/resume`, {})).status).toBe(409)
    expect(await (await f.post(`runs/${id}/cancel`, {})).json()).toMatchObject({
      revoked: true,
      state: "cancelled",
    })
    expect(
      (
        await f.app.request(`/api/full-book-test/${f.setup.id}/runs/${id}/export`, {
          headers: { host: "localhost:8787" },
        })
      ).status,
    ).toBe(200)
  } finally {
    f.cleanup()
  }
})
it("does not turn an internal fixture consent into execution authority in a default runtime-unbound app", async () => {
  // Given an existing exact fixture consent and another app with the default disabled runtime boundary.
  const f = fullBookServerFixture()
  try {
    const id = await admit(f),
      app = createApp({
        reviewStorage: f.storage,
        sources: f.storage.sources,
        libraryOwnerId: f.budget.ownerId,
        serverHost: "127.0.0.1",
        security: {
          trustedOrigins: ["http://localhost:8787"],
          trustProxy: false,
          apiBodyBytes: 100000,
          loginBodyBytes: 10000,
          uploadBodyBytes: 100000,
          loginRateLimit: { attempts: 5, windowMs: 1000 },
        },
      })
    // When browser input asks to resume or enable, then the default boundary issues no work.
    const post = (body: unknown) =>
      app.request(`/api/full-book-test/${f.setup.id}/runs/${id}/resume`, {
        method: "POST",
        headers: {
          host: "localhost:8787",
          origin: "http://localhost:8787",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      })
    expect((await post({})).status).toBe(409)
    expect((await post({ enabled: true })).status).toBe(400)
    expect(z.object({ attempts: z.literal(0) }).parse(f.storage.counts()).attempts).toBe(0)
  } finally {
    f.cleanup()
  }
})
