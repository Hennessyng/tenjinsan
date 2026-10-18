import { expect, test, vi } from "vitest"
import { canary, harness, origin } from "./testing/login-diagnostic-fixture.ts"

test.each(["/login", "/logout", "/api/auth/sign-in/email", "/api/auth/sign-out"])(
  "retired %s retains cross-origin rejection without session mutation",
  async (path) => {
    const handler = vi.fn(async () => new Response(canary))
    const { app } = harness(handler)
    const response = await app.request(origin + path, {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/json",
        cookie: canary,
      },
      body: "{}",
    })
    expect(response.status).toBe(403)
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(await response.text()).not.toContain(canary)
    expect(handler).not.toHaveBeenCalled()
  },
)
test.each(["/login", "/logout"])(
  "same-origin retired %s returns to the library without logging in",
  async (path) => {
    const { app } = harness(async () => new Response(null))
    const response = await app.request(origin + path, {
      method: "POST",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: "ignored=1",
    })
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/")
    expect(response.headers.get("set-cookie")).toBeNull()
  },
)
