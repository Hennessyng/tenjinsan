import { HTTPException } from "hono/http-exception"
import { describe, expect, it, vi } from "vitest"
import {
  canary,
  expectCorrelation,
  formRequest,
  harness,
  origin,
  validBody,
} from "./testing/login-diagnostic-fixture.ts"

describe("owner login response diagnostics", () => {
  it("correlates success without logging request or cookie values", async () => {
    // Given
    const { app, events } = harness(
      async () =>
        new Response(canary, {
          headers: { "set-cookie": `synthetic=${canary}; HttpOnly`, "x-request-id": canary },
        }),
    )
    // When
    const response = await app.request(
      formRequest({ origin, cookie: canary, "user-agent": canary, "x-forwarded-for": canary }),
    )
    // Then
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/")
    expect(response.headers.get("set-cookie")).toContain(`synthetic=${canary}`)
    expectCorrelation(response, events)
    expect(events[0]).toMatchObject({
      event: "auth.login.success",
      category: "success",
      upstream_status: 200,
      status: 303,
    })
    expect(Object.keys(events[0] ?? {}).sort()).toEqual([
      "category",
      "event",
      "level",
      "method",
      "requestId",
      "route",
      "status",
      "trace_id",
      "upstream_status",
    ])
  })

  it("keeps the generic 500 response and omits raw errors when the handler throws", async () => {
    // Given
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { app, events } = harness(async () => {
      throw new TypeError(canary)
    })
    try {
      // When
      const response = await app.request(formRequest())
      // Then
      expect(response.status).toBe(500)
      expect(await response.text()).toBe("Internal Server Error")
      expectCorrelation(response, events)
      expect(events[0]).toMatchObject({
        event: "auth.login.exception",
        category: "internal",
        status: 500,
      })
      expect(consoleError.mock.calls.length).toBe(0)
    } finally {
      consoleError.mockRestore()
    }
  })

  it("preserves HTTPException responses when the handler throws a typed HTTP error", async () => {
    // Given
    const { app, events } = harness(async () => {
      throw new HTTPException(503, { res: new Response("Unavailable", { status: 503 }) })
    })
    // When
    const response = await app.request(formRequest())
    // Then
    expect(response.status).toBe(503)
    expect(await response.text()).toBe("Unavailable")
    expectCorrelation(response, events)
    expect(events[0]).toMatchObject({
      event: "auth.login.exception",
      category: "internal",
      status: 503,
    })
  })

  it.each(["/login", "/api/auth/sign-in/email"])(
    "does not let a logger failure change %s responses",
    async (path) => {
      // Given
      const logger = vi.fn(() => {
        throw new TypeError(canary)
      })
      const { app } = harness(
        async () => Response.json({ code: "INVALID_ORIGIN" }, { status: 403 }),
        logger,
      )
      // When
      const response = await app.request(`${origin}${path}`, {
        method: "POST",
        body: validBody,
        headers: { origin },
      })
      // Then
      expect(response.status).toBe(path === "/login" ? 401 : 403)
      expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
      expect(logger.mock.calls.length).toBe(1)
    },
  )

  it("leaves the direct auth rejection body intact when classifying its clone", async () => {
    // Given
    const body = JSON.stringify({ code: "INVALID_ORIGIN", message: canary })
    const { app, events } = harness(async () => new Response(body, { status: 403 }))
    // When
    const response = await app.request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      body: validBody,
      headers: { origin },
    })
    // Then
    expect(response.status).toBe(403)
    expect(await response.text()).toBe(body)
    expectCorrelation(response, events)
    expect(events[0]).toMatchObject({ category: "origin", upstream_status: 403, status: 403 })
  })

  it("uses a constant fallback when the auth rejection exceeds the inspection limit", async () => {
    // Given
    const { app, events } = harness(
      async () =>
        new Response(`{"code":"INVALID_ORIGIN","message":"${"x".repeat(8192)}"}`, { status: 403 }),
    )
    // When
    const response = await app.request(formRequest())
    // Then
    expectCorrelation(response, events)
    expect(events[0]).toMatchObject({ category: "unknown", upstream_status: 403 })
  })
})
