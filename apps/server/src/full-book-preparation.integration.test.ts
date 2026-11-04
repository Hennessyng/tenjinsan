import { expect, it, vi } from "vitest"
import { z } from "zod"
import { createApp } from "./app.ts"
import { preparationFixture } from "./testing/full-book-preparation-fixture.ts"

function given(serverHost = "127.0.0.1", owner = "owner-1") {
  const f = preparationFixture()
  const app = createApp({
    reviewStorage: f.storage,
    sources: f.storage.sources,
    libraryOwnerId: owner,
    serverHost,
    security: {
      trustedOrigins: ["http://localhost:8787"],
      trustProxy: false,
      apiBodyBytes: 100000,
      loginBodyBytes: 10000,
      uploadBodyBytes: 100000,
      loginRateLimit: { attempts: 5, windowMs: 1000 },
    },
  })
  const options = {
    mode: "full-book-test-1",
    policy: f.budget.session.input.policy,
    sourceCeiling: 100,
    collectorBytes: 10000,
    timeoutMs: 1000,
  }
  const post = (action: string, value: unknown) =>
    app.request(`/api/full-book-test/${f.setup.id}/${action}`, {
      method: "POST",
      headers: {
        origin: "http://localhost:8787",
        host: "localhost:8787",
        "content-type": "application/json",
      },
      body: JSON.stringify(value),
    })
  return { ...f, app, options, post }
}
it("prepares only an explicit experimental mode from stored source/route without grants or managed discovery", async () => {
  // Given stored fake source, route and a prior pending source-budget hold.
  const f = given(),
    refresh = vi.spyOn(f.storage.subscriptionLogin, "refresh"),
    status = vi.spyOn(f.storage.subscriptionLogin, "status")
  try {
    const before = f.storage.fullBookConsent.commitments(
      f.budget.ownerId,
      f.budget.session.input.normalization.editionHash,
    )
    // When the owner asks for an explicit dry run.
    const response = await f.post("prepare", f.options)
    expect(response.status, await response.clone().text()).toBe(200)
    const prepared = z
      .object({
        mode: z.literal("full-book-test-1"),
        kind: z.literal("ready"),
        reviewBinding: z.string(),
        native: z.object({
          enabled: z.literal(false),
          reason: z.literal("release-and-runtime-binding-required"),
        }),
        hierarchy: z.object({ windows: z.literal(1), levels: z.literal(1) }),
        source: z.object({
          coverage: z.literal("partial"),
          omissions: z.array(z.unknown()).length(13),
          originalFileIncluded: z.literal(false),
        }),
        budget: z.object({
          spent: z.literal(0),
          held: z.number().positive(),
          unknown: z.literal(0),
          proposedMaxAttempts: z.number().positive(),
          sourceCeiling: z.literal(100),
        }),
      })
      .parse(await response.clone().json())
    // Then preparation neither changes holds nor treats cached route metadata as live readiness.
    expect(prepared.budget.held).toBe(before.held)
    expect(
      f.storage.fullBookConsent.commitments(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ),
    ).toEqual(before)
    expect(refresh).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
    expect(await response.clone().text()).not.toContain("FIXTURE_MARKER")
  } finally {
    refresh.mockRestore()
    status.mockRestore()
    f.cleanup()
  }
})
it("keeps an unchanged review grant-free and rejects a changed source ceiling", async () => {
  // Given a dry-run review binding, not a sending grant.
  const f = given()
  try {
    const preparation = await f.post("prepare", f.options)
    const { reviewBinding } = z
      .object({ reviewBinding: z.string() })
      .parse(await preparation.json())
    // When review is refreshed, then only identical current options match.
    const current = await f.post("review", { options: f.options, reviewBinding })
    expect(current.status).toBe(200)
    expect(current.headers.get("cache-control")).toBe("private, no-store")
    const changed = await f.post("review", {
      options: { ...f.options, sourceCeiling: 99 },
      reviewBinding,
    })
    expect(changed.status).toBe(409)
    expect(await changed.json()).toMatchObject({ error: "review-stale", transmission: "not-sent" })
  } finally {
    f.cleanup()
  }
})
it.each(["budget", "setup", "connection", "catalog"])(
  "rechecks %s changes before accepting a review",
  async (change) => {
    // Given a review prepared before the corresponding stored authority changes.
    const f = given()
    try {
      const prepared = await f.post("prepare", f.options)
      const { reviewBinding } = z.object({ reviewBinding: z.string() }).parse(await prepared.json())
      switch (change) {
        case "budget":
          f.storage.fullBookConsent.close(f.budget.id, "synthetic owner decision")
          break
        case "setup":
          f.storage.sources.appendSetup({
            record: { ...f.setup, id: "revised-preparation-setup" },
            parentRevisionId: f.setup.id,
          })
          break
        case "connection":
          f.storage.subscriptionConnections.disconnect(
            f.budget.session.destination.installationId,
            "chatgpt-subscription",
          )
          break
        case "catalog":
          f.setCachedSession({ ...f.state, models: [] })
          break
        default:
          throw new TypeError("Unexpected test change")
      }
      // When review is requested, then the old binding cannot survive changed authority.
      expect((await f.post("review", { options: f.options, reviewBinding })).status).toBe(409)
    } finally {
      f.cleanup()
    }
  },
)
it("refuses another owner's saved setup", async () => {
  // Given another local library namespace.
  const f = given("127.0.0.1", "owner-2")
  try {
    // When a foreign setup is requested, then source details stay unavailable.
    const response = await f.post("prepare", f.options)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: "source-or-route-stale",
      transmission: "not-sent",
    })
  } finally {
    f.cleanup()
  }
})
it.each(["consent", "send"])("never enables %s through browser input", async (action) => {
  // Given caller-authored release and runtime flags.
  const f = given()
  try {
    const before = f.storage.fullBookConsent.preview(
      f.budget.ownerId,
      f.budget.session.input.normalization.editionHash,
    )
    // When an authority endpoint is called, then it refuses without changing accounting.
    const response = await f.post(action, {
      ...f.options,
      nativeEnabled: true,
      releaseApproved: true,
    })
    expect(response.status).toBe(action === "consent" ? 400 : 409)
    expect(await response.json()).toMatchObject({
      error:
        action === "consent" ? "invalid-exact-consent" : "release-and-runtime-binding-required",
      transmission: "not-sent",
    })
    expect(
      f.storage.fullBookConsent.preview(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ),
    ).toEqual(before)
  } finally {
    f.cleanup()
  }
})
it.each([
  {},
  { origin: "http://evil.example" },
  { origin: "http://localhost:8787", forwarded: "for=127.0.0.1" },
])("refuses missing, foreign or forwarded origin headers %j", async (headers) => {
  // Given a request outside the local direct-origin boundary.
  const f = given()
  try {
    // When preparation is requested, then access is refused before source review.
    const response = await f.app.request(`/api/full-book-test/${f.setup.id}/prepare`, {
      method: "POST",
      headers: { ...headers, host: "localhost:8787", "content-type": "application/json" },
      body: JSON.stringify(f.options),
    })
    expect(response.status).toBe(403)
  } finally {
    f.cleanup()
  }
})
it("refuses preparation on a non-loopback deployment even with a trusted origin", async () => {
  // Given a hosted listener with otherwise trusted request headers.
  const f = given("0.0.0.0")
  try {
    // When preparation is requested, then no experimental source review is exposed.
    expect((await f.post("prepare", f.options)).status).toBe(403)
  } finally {
    f.cleanup()
  }
})
it("refuses a saved route when its cached account metadata is missing", async () => {
  // Given a saved destination without matching cached session evidence.
  const f = given()
  try {
    f.clearCachedSession()
    // When the owner prepares, then stale route metadata cannot masquerade as a match.
    const response = await f.post("prepare", f.options)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: "source-or-route-stale",
      transmission: "not-sent",
    })
  } finally {
    f.cleanup()
  }
})
it("does not default to experimental mode and never accepts a browser native-enable knob", async () => {
  // Given omitted mode or a caller-authored runtime bypass.
  const f = given()
  try {
    for (const value of [
      { ...f.options, mode: undefined },
      { ...f.options, nativeEnabled: true },
    ]) {
      // When/Then the request is refused without creating authority.
      expect((await f.post("prepare", value)).status).toBe(400)
    }
  } finally {
    f.cleanup()
  }
})
