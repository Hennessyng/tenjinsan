import { createHash } from "node:crypto"
import { PassThrough } from "node:stream"
import { expect, it } from "vitest"
import { RpcFrameWriter, rpcFrameObservation } from "../src/rpc-frame.ts"

it.each(["chatgpt-subscription", "grok-subscription"] as const)(
  "writes exactly the measured UTF-8 envelope for %s",
  (provider) => {
    const stream = new PassThrough()
    const writer = new RpcFrameWriter(provider, stream, Number.MAX_SAFE_INTEGER - 1)
    const params = {
      threadId: '早🧭\\"\n',
      model: "fixture-model",
      input: [{ text: 'é\n\t"\\' }],
      outputSchema: { type: "object" },
    }
    const frame = writer.prepare("turn/start", params, "a".repeat(64))
    writer.write(frame, { maxBytes: frame.bytes, expectedBinding: "a".repeat(64) })
    const written: unknown = stream.read()
    expect(Buffer.isBuffer(written)).toBe(true)
    if (!Buffer.isBuffer(written)) throw new TypeError("Expected binary stream output")
    const expected = Buffer.from(
      `${JSON.stringify({ ...(provider === "grok-subscription" ? { jsonrpc: "2.0" } : {}), id: Number.MAX_SAFE_INTEGER, method: "turn/start", params })}\n`,
      "utf8",
    )
    expect(written.equals(expected)).toBe(true)
    expect(rpcFrameObservation(frame)).toMatchObject({
      bytes: written.length,
      sha256: createHash("sha256").update(written).digest("hex"),
      downstreamInput: "unmeasured",
    })
  },
)
it.each([NaN, Infinity, -1, 1.5])("writes nothing for invalid byte limit %s", (maxBytes) => {
  const stream = new PassThrough()
  const writer = new RpcFrameWriter("chatgpt-subscription", stream)
  const frame = writer.prepare("turn/start", {})
  expect(() => writer.write(frame, { maxBytes })).toThrow("frame-limit")
  expect(stream.read()).toBeNull()
})
it.each(["overflow", "binding", "forged", "foreign", "replay"] as const)(
  "writes nothing for %s",
  (kind) => {
    const stream = new PassThrough()
    const writer = new RpcFrameWriter("chatgpt-subscription", stream)
    const frame = writer.prepare("turn/start", {}, "a".repeat(64))
    const foreign = new RpcFrameWriter("chatgpt-subscription", new PassThrough()).prepare(
      "turn/start",
      {},
    )
    if (kind === "replay") {
      writer.write(frame)
      stream.read()
    }
    const selected =
      kind === "forged"
        ? { ...frame, serialized: "changed\n" }
        : kind === "foreign"
          ? foreign
          : frame
    expect(() =>
      writer.write(selected, {
        maxBytes: kind === "overflow" ? frame.bytes - 1 : 32000,
        expectedBinding: kind === "binding" ? "b".repeat(64) : "a".repeat(64),
      }),
    ).toThrow()
    expect(stream.read()).toBeNull()
  },
)
it("writes the measured snapshot even if the caller later mutates its params", () => {
  const stream = new PassThrough()
  const writer = new RpcFrameWriter("chatgpt-subscription", stream)
  const params = { model: "original", schema: { type: "object" } }
  const frame = writer.prepare("turn/start", params)
  params.model = "changed"
  params.schema.type = "string"
  writer.write(frame)
  const written: unknown = stream.read()
  expect(Buffer.isBuffer(written) && written.toString("utf8") === frame.serialized).toBe(true)
})
