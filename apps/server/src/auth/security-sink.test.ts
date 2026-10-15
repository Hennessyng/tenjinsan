import { Writable } from "node:stream"
import { setImmediate } from "node:timers/promises"
import { describe, expect, it, vi } from "vitest"
import { createDefaultSecuritySink } from "../middleware/security-sink.ts"
import { canary, formRequest, harness } from "./testing/login-diagnostic-fixture.ts"

describe("bounded default security output", () => {
  it("drops events while the output is backpressured", async () => {
    // Given: a real in-memory Writable whose first write cannot finish yet.
    let finish: (error?: Error | null) => void = () => undefined
    let line = ""
    const output = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        line = chunk.toString()
        finish = callback
      },
    })
    const write = vi.spyOn(output, "write")
    const sink = createDefaultSecuritySink(output)
    const { app } = harness(async () => new Response(null), sink)
    const first = await app.request(formRequest())
    try {
      // When
      const response = await app.request(formRequest())
      // Then
      expect(response.status).toBe(303)
      expect(write.mock.calls.length).toBe(1)
      const event: unknown = JSON.parse(line)
      expect(event).toMatchObject({ trace_id: first.headers.get("x-request-id") })
      expect(line).not.toContain(canary)
    } finally {
      finish()
      output.destroy()
    }
  })

  it("resumes event delivery when the owned stream has drained", async () => {
    // Given
    let finish: (error?: Error | null) => void = () => undefined
    let line = ""
    const output = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        line = chunk.toString()
        finish = callback
      },
    })
    const sink = createDefaultSecuritySink(output)
    const { app } = harness(async () => new Response(null), sink)
    await app.request(formRequest())
    finish()
    await setImmediate()
    try {
      // When
      const response = await app.request(formRequest())
      // Then
      const event: unknown = JSON.parse(line)
      expect(event).toMatchObject({ trace_id: response.headers.get("x-request-id") })
      expect(response.status).toBe(303)
    } finally {
      finish()
      output.destroy()
    }
  })

  it("stops writing after an asynchronous sink error without changing responses", async () => {
    // Given
    let finish: (error?: Error | null) => void = () => undefined
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        finish = callback
      },
    })
    // This observer belongs only to the synthetic stream; it prevents the RED harness crashing.
    let errors = 0
    output.on("error", () => {
      errors += 1
    })
    const write = vi.spyOn(output, "write")
    const sink = createDefaultSecuritySink(output)
    const { app } = harness(async () => new Response(null, { status: 403 }), sink)
    await app.request(formRequest())
    try {
      // When
      finish(new TypeError(canary))
      await setImmediate()
      const response = await app.request(formRequest())
      // Then
      expect(errors).toBe(1)
      expect(response.status).toBe(401)
      expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
      expect(write.mock.calls.length).toBe(1)
    } finally {
      output.destroy()
    }
  })

  it("does not attach error handlers to global stdout", () => {
    // Given
    const listeners = process.stdout.listenerCount("error")
    // When
    createDefaultSecuritySink()
    // Then
    expect(process.stdout.listenerCount("error")).toBe(listeners)
  })
})
