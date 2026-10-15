import { describe, expect, it } from "vitest"
import { createApp, type SecurityEvent } from "../app.ts"
import { canary, expectCorrelation, origin } from "./testing/login-diagnostic-fixture.ts"

describe("remaining access rejection correlation", () => {
  it.each([
    ["anonymous", "GET", 401, "session"],
    ["wrong-media", "POST", 415, "content-type"],
    ["unowned", "GET", 404, "resource"],
  ])(
    "correlates %s rejection without private values",
    async (condition, method, status, category) => {
      // Given
      const events: SecurityEvent[] = []
      const app = createApp({
        auth: {
          handler: async () => new Response(null),
          ownerId: async () => (condition === "anonymous" ? null : canary),
        },
        configurePrivateApi: (api) => {
          api.on(["GET", "POST"], "/api/jobs/:id", (context) => context.body(null, 202))
        },
        security: {
          apiBodyBytes: 1024,
          loginBodyBytes: 1024,
          uploadBodyBytes: 1024,
          loginRateLimit: { attempts: 5, windowMs: 60_000 },
          trustedOrigins: [origin],
          trustProxy: false,
          resourceAccess: { canAccess: async () => false },
          logger: (event) => {
            events.push(event)
          },
        },
      })
      // When
      const response = await app.request(`${origin}/api/jobs/${canary}?private=${canary}`, {
        method,
        headers: { origin, "content-type": "text/plain", "x-request-id": canary },
      })
      // Then
      expect(response.status).toBe(status)
      expectCorrelation(response, events)
      expect(events[0]).toMatchObject({ category, status })
    },
  )
})
