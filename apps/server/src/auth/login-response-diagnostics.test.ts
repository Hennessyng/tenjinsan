import { expect, test, vi } from "vitest"
import { canary, harness, origin } from "./testing/login-diagnostic-fixture.ts"

test.each(["/api/auth/sign-in/email", "/api/auth/get-session"])(
  "retired %s does not invoke or conceal an active auth error",
  async (path) => {
    const handler = vi.fn(async () => {
      throw new Error(canary)
    })
    const { app, events } = harness(handler)
    const response = await app.request(origin + path)
    expect(response.status).toBe(410)
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(await response.text()).not.toContain(canary)
    expect(events).toEqual([])
    expect(handler).not.toHaveBeenCalled()
  },
)
