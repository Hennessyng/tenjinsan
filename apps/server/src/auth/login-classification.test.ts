import { setImmediate } from "node:timers/promises"
import { describe, expect, it, vi } from "vitest"
import { classifyLoginRejection } from "./login-classification.ts"

describe("bounded auth rejection inspection", () => {
  it("handles a pending read rejection after the deadline has already won", async () => {
    // Given: a narrow synthetic reader whose pending read outlives cancellation.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const response = new Response("synthetic", { status: 403 })
    const clone = response.clone()
    if (clone.body === null) throw new TypeError("Missing synthetic stream")
    const reader = clone.body.getReader()
    let rejectRead: (reason: unknown) => void = () => {
      throw new TypeError("Read not initialized")
    }
    const pendingRead = new Promise<ReadableStreamReadResult<Uint8Array<ArrayBuffer>>>(
      (_resolve, reject) => {
        rejectRead = reject
      },
    )
    const read = vi.spyOn(reader, "read").mockReturnValue(pendingRead)
    vi.spyOn(clone.body, "getReader").mockReturnValue(reader)
    vi.spyOn(response, "clone").mockReturnValue(clone)
    let unhandled = 0
    const observe = () => {
      unhandled += 1
    }
    process.on("unhandledRejection", observe)
    try {
      // When
      const classification = classifyLoginRejection(response)
      await vi.advanceTimersByTimeAsync(100)
      const category = await classification
      rejectRead(new TypeError("synthetic-late-read"))
      await setImmediate()
      // Then: Promise.race retains a rejection reaction even after its timer settles it.
      expect(category).toBe("unknown")
      expect(read.mock.calls.length).toBe(1)
      expect(unhandled).toBe(0)
    } finally {
      process.off("unhandledRejection", observe)
      vi.restoreAllMocks()
      await response.body?.cancel()
      vi.useRealTimers()
    }
  })

  it.each([4096, 4097, 1_048_576])(
    "bounds decoded data when a source produces one %i-byte chunk",
    async (size) => {
      // Given: upstream allocation is deliberately outside the classifier's control.
      const prefix = '{"code":"INVALID_ORIGIN"}'
      const response = new Response(new TextEncoder().encode(prefix.padEnd(size, " ")), {
        status: 403,
      })
      const decode = vi.spyOn(TextDecoder.prototype, "decode")
      try {
        // When
        const category = await classifyLoginRejection(response)
        // Then: an over-budget chunk is not decoded or copied into retained text.
        const decodedBytes = decode.mock.calls.reduce(
          (sum, [input]) => sum + (input?.byteLength ?? 0),
          0,
        )
        expect(decodedBytes).toBeLessThanOrEqual(4096)
        expect(category).toBe(size === 4096 ? "origin" : "unknown")
        if (size > 4096) expect(decode.mock.calls.length).toBe(0)
      } finally {
        decode.mockRestore()
        await response.body?.cancel()
      }
    },
  )

  it("does not decode the chunk that crosses the accumulated inspection budget", async () => {
    // Given
    const prefix = '{"code":"INVALID_ORIGIN"}'.padEnd(4090, " ")
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(prefix))
          controller.enqueue(new TextEncoder().encode(" ".repeat(32)))
          controller.close()
        },
      }),
      { status: 403 },
    )
    const decode = vi.spyOn(TextDecoder.prototype, "decode")
    try {
      // When
      const category = await classifyLoginRejection(response)
      // Then
      const decodedBytes = decode.mock.calls.reduce(
        (sum, [input]) => sum + (input?.byteLength ?? 0),
        0,
      )
      expect(category).toBe("unknown")
      expect(decodedBytes).toBe(4090)
    } finally {
      decode.mockRestore()
      await response.body?.cancel()
    }
  })

  it.each([
    "not-json",
    "null",
    '{"code":42}',
    '{"code":"UNRECOGNIZED"}',
    '{"code":"EMAIL_NOT_VERIFIED"}',
    '{"code":"PASSWORD_TOO_LONG"}',
    '{"code":"VALIDATION_ERROR"}',
  ])("uses a constant fallback when the upstream body is %s", async (body) => {
    // Given
    const response = new Response(body, { status: 403 })
    // When
    const category = await classifyLoginRejection(response)
    // Then
    expect(category).toBe("unknown")
    expect(await response.text()).toBe(body)
  })

  it("does not wait indefinitely when the upstream clone stalls", async () => {
    // Given
    vi.useFakeTimers()
    const response = new Response(new ReadableStream<Uint8Array>(), { status: 403 })
    try {
      // When
      const pending = classifyLoginRejection(response)
      await vi.advanceTimersByTimeAsync(100)
      const category = await pending
      // Then
      expect(category).toBe("unknown")
    } finally {
      await response.body?.cancel()
      vi.useRealTimers()
    }
  })
})
