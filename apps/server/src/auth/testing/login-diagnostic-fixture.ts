import { expect } from "vitest"
import { createApp, type SecurityEvent } from "../../app.ts"

export const origin = "http://studio.test"
export const canary = "synthetic-private-canary"
export const validBody = new URLSearchParams({ email: "fixture@example.test", password: canary })

export function harness(
  handler: (request: Request) => Promise<Response>,
  logger?: (event: SecurityEvent) => void,
) {
  const events: SecurityEvent[] = []
  const app = createApp({
    libraryOwnerId: "library-owner",
    auth: { handler, ownerId: async () => null },
    security: {
      apiBodyBytes: 1024,
      loginBodyBytes: 1024,
      loginRateLimit: { attempts: 2, windowMs: 60_000 },
      logger:
        logger ??
        ((event) => {
          events.push(event)
        }),
      trustedOrigins: [origin],
      trustProxy: false,
      uploadBodyBytes: 1024,
    },
  })
  return { app, events }
}

export function formRequest(headers: Record<string, string> = { origin }, body = validBody) {
  return new Request(`${origin}/login?private=${canary}`, {
    method: "POST",
    body,
    headers: { "x-request-id": canary, ...headers },
  })
}

export function expectCorrelation(response: Response, events: readonly SecurityEvent[]) {
  const trace = response.headers.get("x-request-id")
  expect(trace).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ requestId: trace, trace_id: trace })
  expect(JSON.stringify(events)).not.toContain(canary)
  expect(JSON.stringify(events)).not.toContain("fixture@example.test")
}
