import { expect, test, vi } from "vitest"
import { canary, harness, origin } from "./testing/login-diagnostic-fixture.ts"

test.each(["sign-in/email", "sign-up/email", "sign-out", "get-session"])(
  "removed auth endpoint %s never authenticates or creates a cookie",
  async (path) => {
    const authenticate = vi.fn(
      async () => new Response(canary, { headers: { "set-cookie": canary } }),
    )
    const { app } = harness(authenticate)
    const response = await app.request(`${origin}/api/auth/${path}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}",
    })
    expect(response.status).toBe(410)
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(await response.text()).not.toContain(canary)
    expect(authenticate).not.toHaveBeenCalled()
  },
)
test("unprovisioned root is available without a fake session", async () => {
  const { app } = harness(async () => new Response(null, { status: 401 }))
  const response = await app.request(origin + "/")
  expect(response.status).toBe(200)
  expect(response.headers.get("set-cookie")).toBeNull()
  expect(response.headers.get("location")).toBeNull()
})
