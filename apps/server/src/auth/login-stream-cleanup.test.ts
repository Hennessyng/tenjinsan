import { setImmediate } from "node:timers/promises"
import { describe, expect, it, vi } from "vitest"
import {
  expectCorrelation,
  formRequest,
  harness,
  origin,
  validBody,
} from "./testing/login-diagnostic-fixture.ts"

describe("auth rejection stream ownership", () => {
  it("releases the discarded source without blocking when form classification times out", async () => {
    // Given
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    let release: () => void = () => undefined
    const cancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const upstream = new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 403 })
    const { app, events } = harness(async () => upstream)
    try {
      // When
      const pending = app.request(formRequest())
      await vi.advanceTimersByTimeAsync(100)
      const response = await pending
      await setImmediate()
      // Then: cancellation may remain pending, but the generic response does not wait for it.
      expect(response.status).toBe(401)
      expectCorrelation(response, events)
      expect(events[0]).toMatchObject({ category: "unknown", upstream_status: 403 })
      expect(cancel.mock.calls.length).toBe(1)
    } finally {
      const cleanup = upstream.body?.cancel().catch(() => undefined)
      release()
      await cleanup
      vi.useRealTimers()
    }
  })

  it("keeps the original direct response readable after the clone times out", async () => {
    // Given
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    let finish: () => void = () => undefined
    const body = '{"code":"INVALID_ORIGIN","message":"synthetic-only"}'
    const cancel = vi.fn()
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          finish = () => {
            controller.enqueue(new TextEncoder().encode(body))
            controller.close()
          }
        },
        cancel,
      }),
      { status: 403 },
    )
    const { app, events } = harness(async () => upstream)
    try {
      // When
      const pending = app.request(`${origin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin },
        body: validBody,
      })
      await vi.advanceTimersByTimeAsync(100)
      const response = await pending
      finish()
      const returnedBody = await response.text()
      // Then
      expect(response.status).toBe(403)
      expect(returnedBody).toBe(body)
      expectCorrelation(response, events)
      expect(events[0]).toMatchObject({ category: "unknown", upstream_status: 403 })
      expect(cancel.mock.calls.length).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("releases a status-only form rejection even when source cancellation rejects", async () => {
    // Given
    const cancel = vi.fn(async () => {
      throw new TypeError("synthetic-cancellation")
    })
    const upstream = new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 500 })
    const { app, events } = harness(async () => upstream)
    try {
      // When
      const response = await app.request(formRequest())
      await setImmediate()
      // Then
      expect(response.status).toBe(401)
      expectCorrelation(response, events)
      expect(events[0]).toMatchObject({ category: "internal", upstream_status: 500 })
      expect(cancel.mock.calls.length).toBe(1)
    } finally {
      await upstream.body?.cancel().catch(() => undefined)
    }
  })
})
