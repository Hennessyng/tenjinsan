import { describe, expect, it, vi } from "vitest"
import {
  canary,
  expectCorrelation,
  formRequest,
  harness,
  origin,
} from "./testing/login-diagnostic-fixture.ts"

describe("safe early boundary traces", () => {
  it.each([`/sources/${canary}`, `/api/${canary}/${canary}`, `/${canary}`])(
    "omits private path segments when rejecting %s",
    async (path) => {
      // Given
      const { app, events } = harness(async () => new Response(null))
      // When
      const response = await app.request(`${origin}${path}?private=${canary}`, {
        headers: { host: "attacker.test", "x-request-id": canary },
      })
      // Then
      expect(response.status).toBe(421)
      expectCorrelation(response, events)
    },
  )

  it("keeps boundary rejection intact when the logger throws", async () => {
    // Given
    const logger = vi.fn(() => {
      throw new TypeError(canary)
    })
    const { app } = harness(async () => new Response(null), logger)
    // When
    const response = await app.request(formRequest({ origin: "http://attacker.test" }))
    // Then
    expect(response.status).toBe(403)
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
    expect(logger.mock.calls.length).toBe(1)
  })

  it("preserves non-Error throw propagation while recording only a safe category", async () => {
    // Given
    const thrown = { private: canary }
    const { app, events } = harness(async () => {
      throw thrown
    })
    // When / Then: no response is fabricated for a throwable Hono itself does not handle.
    await expect(app.request(formRequest())).rejects.toBe(thrown)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: "auth.login.exception",
      category: "internal",
      status: null,
    })
    expect(JSON.stringify(events)).not.toContain(canary)
  })

  it("does not label unrelated auth throws as login failures", async () => {
    // Given
    const thrown = { private: canary }
    const { app, events } = harness(async () => {
      throw thrown
    })
    // When / Then
    await expect(app.request(`${origin}/api/auth/get-session`)).rejects.toBe(thrown)
    expect(events).toHaveLength(0)
  })
})
