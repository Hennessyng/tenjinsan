import { describe, expect, it, vi } from "vitest"
import { loginPage } from "./login-page.ts"
import {
  canary,
  expectCorrelation,
  formRequest,
  harness,
  origin,
} from "./testing/login-diagnostic-fixture.ts"

describe("safe owner login diagnostics", () => {
  it("omits an invalid trace reference instead of rendering markup", () => {
    // Given an untrusted value, when rendering a failure, then only UUIDs are displayed.
    expect(loginPage(true, "login", '<script src="/unsafe"></script>')).not.toContain("/unsafe")
    expect(loginPage(true, "login", "invalid")).not.toContain("<code data-trace-id>")
  })
  it("correlates validation failure when the form is invalid", async () => {
    // Given
    const handler = vi.fn(async () => new Response(null))
    const { app, events } = harness(handler)
    // When
    const response = await app.request(
      formRequest({ origin }, new URLSearchParams({ email: canary })),
    )
    // Then
    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
    expectCorrelation(response, events)
    const traceId = response.headers.get("X-Request-ID")
    expect(response.headers.get("X-Trace-ID")).toBe(traceId)
    expect(await response.text()).toContain(`<code data-trace-id>${traceId}</code>`)
    expect(events[0]).toMatchObject({
      event: "auth.login.validation",
      category: "validation",
      status: 401,
    })
  })

  it.each([
    ["INVALID_EMAIL_OR_PASSWORD", 401, "invalid-credentials"],
    ["INVALID_ORIGIN", 403, "origin"],
    ["MISSING_OR_NULL_ORIGIN", 403, "origin"],
    ["CROSS_SITE_NAVIGATION_LOGIN_BLOCKED", 403, "cross-site"],
    ["FAILED_TO_CREATE_SESSION", 401, "session"],
    ["SESSION_EXPIRED", 401, "session"],
    ["INVALID_EMAIL", 400, "validation"],
    ["TOO_MANY_REQUESTS", 429, "rate-limit"],
    [canary, 500, "internal"],
    [canary, 403, "unknown"],
  ])(
    "classifies %s without exposing its response when auth rejects",
    async (code, status, category) => {
      // Given
      const { app, events } = harness(async () =>
        Response.json({ code, message: canary }, { status }),
      )
      // When
      const response = await app.request(formRequest())
      // Then
      expect(response.status).toBe(401)
      expectCorrelation(response, events)
      const traceId = response.headers.get("X-Request-ID")
      expect(response.headers.get("X-Trace-ID")).toBe(traceId)
      const html = await response.text()
      expect(html).toContain(`<code data-trace-id>${traceId}</code>`)
      expect(events[0]).toMatchObject({
        event: "auth.login.rejected",
        category,
        upstream_status: status,
        status: 401,
      })
      expect(html).not.toContain(canary)
    },
  )

  it.each([
    [{ origin: "http://attacker.test" }, 403, "access.origin", "origin"],
    [{ origin, host: "attacker.test" }, 421, "access.host", "host"],
    [{}, 403, "auth.login.validation", "origin"],
  ])("correlates early rejection when headers are %j", async (headers, status, event, category) => {
    // Given
    const handler = vi.fn(async () => new Response(null))
    const { app, events } = harness(handler)
    // When
    const response = await app.request(formRequest(headers))
    // Then
    expect(response.status).toBe(status)
    expect(response.headers.get("X-Trace-ID")).toBe(response.headers.get("X-Request-ID"))
    expect(handler).not.toHaveBeenCalled()
    expectCorrelation(response, events)
    expect(events[0]).toMatchObject({ event, category, status })
  })

  it("correlates a body limit rejection before parsing", async () => {
    // Given
    const { app, events } = harness(async () => new Response(null))
    // When
    const response = await app.request(
      formRequest({ origin }, new URLSearchParams({ padding: "x".repeat(2048) })),
    )
    // Then
    expect(response.status).toBe(413)
    expectCorrelation(response, events)
    expect(events[0]).toMatchObject({ event: "access.body_limit", category: "body-limit" })
  })

  it("correlates rate limiting when prior sign-ins failed", async () => {
    // Given
    const { app, events } = harness(async () =>
      Response.json({ code: "INVALID_EMAIL_OR_PASSWORD" }, { status: 401 }),
    )
    await app.request(formRequest())
    await app.request(formRequest())
    events.splice(0)
    // When
    const response = await app.request(formRequest())
    // Then
    expect(response.status).toBe(429)
    expectCorrelation(response, events)
    expect(events[0]).toMatchObject({ event: "access.rate_limit", category: "rate-limit" })
  })
})
