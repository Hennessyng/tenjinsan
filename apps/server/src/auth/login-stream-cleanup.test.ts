import { expect, test, vi } from "vitest"
import { harness, origin } from "./testing/login-diagnostic-fixture.ts"

test.each(["/login", "/api/auth/sign-in/email"])(
  "retired %s never starts an authentication response stream",
  async (path) => {
    const pull = vi.fn()
    const authenticate = vi.fn(async () => new Response(new ReadableStream({ pull })))
    const { app } = harness(authenticate)
    const response = await app.request(origin + path, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}",
    })
    expect(response.status).toBe(path === "/login" ? 303 : 410)
    expect(authenticate).not.toHaveBeenCalled()
    expect(pull).not.toHaveBeenCalled()
  },
)
