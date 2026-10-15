import { Writable } from "node:stream"
import { setImmediate } from "node:timers/promises"
import { createApp, type SecurityEvent } from "../app.ts"
import { createDefaultSecuritySink } from "../middleware/security-sink.ts"

const origin = "http://synthetic.test"
const form = new URLSearchParams({ email: "synthetic@example.test", password: "synthetic-only" })

function appFor(
  handler: (request: Request) => Promise<Response>,
  logger?: (event: SecurityEvent) => void,
) {
  const events: SecurityEvent[] = []
  const app = createApp({
    auth: { handler, ownerId: async () => null },
    security: {
      apiBodyBytes: 1024,
      loginBodyBytes: 1024,
      uploadBodyBytes: 1024,
      loginRateLimit: { attempts: 5, windowMs: 60_000 },
      trustedOrigins: [origin],
      trustProxy: false,
      logger:
        logger ??
        ((event) => {
          events.push(event)
        }),
    },
  })
  return { app, events }
}

function report(scenario: string, passed: boolean): void {
  process.stdout.write(`${JSON.stringify({ scenario, passed })}\n`)
  if (!passed) process.exitCode = 1
}

function correlated(response: Response, events: readonly SecurityEvent[]): boolean {
  const trace = response.headers.get("x-request-id")
  return (
    trace !== null &&
    events.length === 1 &&
    events[0]?.trace_id === trace &&
    events[0]?.requestId === trace &&
    !JSON.stringify(events).includes("synthetic-only")
  )
}

async function main(): Promise<void> {
  const scenarios = [
    {
      name: "validation",
      body: new URLSearchParams(),
      status: 401,
      category: "validation",
      handler: async () => new Response(null),
    },
    {
      name: "upstream-origin",
      body: form,
      status: 401,
      category: "origin",
      handler: async () => Response.json({ code: "INVALID_ORIGIN" }, { status: 403 }),
    },
    {
      name: "success",
      body: form,
      status: 303,
      category: "success",
      handler: async () => new Response(null),
    },
    {
      name: "exception",
      body: form,
      status: 500,
      category: "internal",
      handler: async () => {
        throw new TypeError("synthetic-only")
      },
    },
  ] as const
  for (const scenario of scenarios) {
    const { app, events } = appFor(scenario.handler)
    const response = await app.request(`${origin}/login`, {
      method: "POST",
      headers: { origin },
      body: scenario.body,
    })
    report(
      scenario.name,
      response.status === scenario.status &&
        events[0]?.category === scenario.category &&
        correlated(response, events),
    )
  }

  const thrown = { private: "synthetic-only" }
  const propagation = appFor(async () => {
    throw thrown
  })
  let propagated = false
  try {
    await propagation.app.request(`${origin}/login`, {
      method: "POST",
      headers: { origin },
      body: form,
    })
  } catch (error) {
    if (error instanceof Error) throw error
    propagated = error === thrown
  }
  report(
    "non-error-no-response",
    propagated && propagation.events.length === 1 && propagation.events[0]?.status === null,
  )

  let cancellations = 0
  const upstream = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        cancellations += 1
      },
    }),
    { status: 403 },
  )
  const mapped = appFor(async () => upstream)
  const mappedResponse = await mapped.app.request(`${origin}/login`, {
    method: "POST",
    headers: { origin },
    body: form,
  })
  await setImmediate()
  report(
    "form-timeout-source-release",
    mappedResponse.status === 401 &&
      cancellations === 1 &&
      correlated(mappedResponse, mapped.events),
  )

  let finishBody: () => void = () => undefined
  const body = '{"code":"INVALID_ORIGIN","message":"synthetic-only"}'
  const directUpstream = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        finishBody = () => {
          controller.enqueue(new TextEncoder().encode(body))
          controller.close()
        }
      },
    }),
    { status: 403 },
  )
  const direct = appFor(async () => directUpstream)
  const directResponse = await direct.app.request(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin },
    body: form,
  })
  finishBody()
  const returnedBody = await directResponse.text()
  report(
    "direct-timeout-readable",
    directResponse.status === 403 &&
      returnedBody === body &&
      correlated(directResponse, direct.events),
  )

  let finishWrite: (error?: Error | null) => void = () => undefined
  let writes = 0
  const blockedOutput = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, callback) {
      writes += 1
      finishWrite = callback
    },
  })
  const blocked = appFor(async () => new Response(null), createDefaultSecuritySink(blockedOutput))
  await blocked.app.request(`${origin}/login`, { method: "POST", headers: { origin }, body: form })
  const blockedResponse = await blocked.app.request(`${origin}/login`, {
    method: "POST",
    headers: { origin },
    body: form,
  })
  report("sink-backpressure", blockedResponse.status === 303 && writes === 1)
  finishWrite()
  blockedOutput.destroy()

  let failWrite: (error?: Error | null) => void = () => undefined
  const failedOutput = new Writable({
    write(_chunk, _encoding, callback) {
      failWrite = callback
    },
  })
  // No observer/global error handler: the production sink must handle its own asynchronous error.
  const failing = appFor(
    async () => new Response(null, { status: 403 }),
    createDefaultSecuritySink(failedOutput),
  )
  await failing.app.request(`${origin}/login`, { method: "POST", headers: { origin }, body: form })
  failWrite(new TypeError("synthetic-only"))
  await setImmediate()
  const failureResponse = await failing.app.request(`${origin}/login`, {
    method: "POST",
    headers: { origin },
    body: form,
  })
  report(
    "sink-async-error",
    failureResponse.status === 401 && failureResponse.headers.has("x-request-id"),
  )
  failedOutput.destroy()
}

// Diagnostic QA boundary: report only the constant failure signal, never a caught error value.
// no-excuse-ok: catch
try {
  await main()
} catch {
  report("unexpected-qa-failure", false)
}
