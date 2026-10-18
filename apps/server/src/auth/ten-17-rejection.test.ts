import { expect, test } from "vitest"
import {
  canary,
  expectCorrelation,
  formRequest,
  harness,
  origin,
} from "./testing/login-diagnostic-fixture.ts"

test.each(["origin", "missing-origin", "body"])(
  "legacy login retains %s boundary with no login UI or reflected fields",
  async (kind) => {
    const { app, events } = harness(async () => new Response(canary))
    const headers =
      kind === "origin"
        ? { origin: "https://attacker.example" }
        : kind === "missing-origin"
          ? {}
          : { origin }
    const response = await app.request(
      formRequest(
        headers,
        kind === "body" ? new URLSearchParams({ ignored: "x".repeat(2048) }) : undefined,
      ),
    )
    expect(response.status).toBe(kind === "body" ? 413 : 403)
    expectCorrelation(response, events)
    const text = await response.text()
    expect(text).not.toContain('name="password"')
    expect(text).not.toContain(canary)
    expect(response.headers.get("set-cookie")).toBeNull()
  },
)
test("retired forms do not retain failed-login session throttling", async () => {
  const { app } = harness(async () => new Response(null, { status: 401 }))
  for (let i = 0; i < 6; i++) expect((await app.request(formRequest())).status).toBe(303)
})
