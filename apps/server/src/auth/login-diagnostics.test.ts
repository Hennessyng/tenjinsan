import { expect, test } from "vitest"
import {
  canary,
  expectCorrelation,
  formRequest,
  harness,
  origin,
} from "./testing/login-diagnostic-fixture.ts"

test("legacy form submission returns to library without credential processing or login events", async () => {
  const { app, events } = harness(async () => new Response(canary))
  const response = await app.request(formRequest())
  expect(response.status).toBe(303)
  expect(response.headers.get("location")).toBe("/")
  expect(response.headers.get("set-cookie")).toBeNull()
  expect(events).toEqual([])
})
test("removed authentication keeps body limits and safe boundary correlation", async () => {
  const { app, events } = harness(async () => new Response(canary))
  const response = await app.request(origin + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ ignored: "x".repeat(2048) }),
  })
  expect(response.status).toBe(413)
  expectCorrelation(response, events)
  expect(events[0]).toMatchObject({ event: "access.body_limit", category: "body-limit" })
})
