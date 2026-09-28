import { once } from "node:events"
import { createServer } from "node:http"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { ProviderAdapter, ProviderError } from "../src/adapter.ts"

const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})
const schema = z.strictObject({ answer: z.string() })
const settings = {
  temperature: 0,
  topP: 1,
  seed: null,
  reasoningEffort: "default",
  maxOutputTokens: 128,
} as const
async function wire(status: number, body: unknown) {
  const requests: unknown[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    response.writeHead(status, { "content-type": "application/json" })
    response.end(JSON.stringify(body))
  })
  servers.push(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new TypeError("Missing wire address")
  return { requests, baseURL: `http://127.0.0.1:${address.port}/v1` }
}
for (const provider of ["openai", "anthropic"] as const) {
  const model = provider === "openai" ? "gpt-4.1-mini" : "claude-sonnet-4-6"
  it(`${provider} measures the SDK envelope before any wire call`, async () => {
    const fixture = await wire(
      200,
      provider === "openai"
        ? {
            id: "chatcmpl-measure",
            object: "chat.completion",
            created: 1,
            model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: '{"answer":"ok"}' },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 4 },
          }
        : {
            id: "msg_measure",
            type: "message",
            role: "assistant",
            model,
            content: [{ type: "text", text: '{"answer":"ok"}' }],
            stop_reason: "end_turn",
            usage: { input_tokens: 8, output_tokens: 4 },
          },
    )
    const adapter = new ProviderAdapter({
      provider,
      apiKey: "fixture-key",
      baseURL: fixture.baseURL,
    })
    const request = {
      model,
      settings,
      prompt: "Synthetic protocol fixture",
      schema: z.toJSONSchema(schema),
      signal: new AbortController().signal,
    }
    const measured = await adapter.measure(request)
    expect(fixture.requests).toHaveLength(0)
    await adapter.dispatch(request)
    expect(measured).toBe(Buffer.byteLength(JSON.stringify(fixture.requests[0])))
  })
  it(`${provider} requests structured output and maps usage when the wire succeeds`, async () => {
    // Given
    const fixture = await wire(
      200,
      provider === "openai"
        ? {
            id: "chatcmpl-fixture",
            object: "chat.completion",
            created: 1,
            model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: '{"answer":"ok"}' },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 4 },
          }
        : {
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            model,
            content: [{ type: "text", text: '{"answer":"ok"}' }],
            stop_reason: "end_turn",
            usage: { input_tokens: 8, output_tokens: 4 },
          },
    )
    const adapter = new ProviderAdapter({
      provider,
      apiKey: "fixture-key",
      baseURL: fixture.baseURL,
    })
    // When
    const result = await adapter.dispatch({
      model,
      settings,
      prompt: "Synthetic protocol fixture",
      schema: z.toJSONSchema(schema),
      signal: new AbortController().signal,
    })
    // Then
    expect(result).toMatchObject({
      kind: "output",
      text: '{"answer":"ok"}',
      usage: { kind: "known", inputTokens: 8, outputTokens: 4 },
    })
    expect(fixture.requests).toHaveLength(1)
    expect(fixture.requests[0]).toMatchObject(
      provider === "openai"
        ? { response_format: { type: "json_schema", json_schema: { strict: true } } }
        : { output_config: { format: { type: "json_schema" } } },
    )
  })
  it(`${provider} makes exactly one wire call when rate limited`, async () => {
    // Given
    const fixture = await wire(429, {
      error: { type: "rate_limit_error", message: "secret vendor detail" },
    })
    const adapter = new ProviderAdapter({
      provider,
      apiKey: "fixture-key",
      baseURL: fixture.baseURL,
    })
    // When
    const result = await adapter.dispatch({
      model,
      settings,
      prompt: "fixture",
      schema: z.toJSONSchema(schema),
      signal: new AbortController().signal,
    })
    // Then
    expect(result).toMatchObject({
      kind: "error",
      code: "rate-limited",
      usage: { kind: "unknown" },
    })
    expect(fixture.requests).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain("secret vendor detail")
  })
  it(`${provider} refuses missing API credentials before dispatch`, () => {
    // Given / When / Then
    expect(() => new ProviderAdapter({ provider, apiKey: "" })).toThrow(ProviderError)
  })
  it(`${provider} rejects an unlisted model before any wire request`, async () => {
    // Given
    const fixture = await wire(200, {})
    const adapter = new ProviderAdapter({
      provider,
      apiKey: "fixture-key",
      baseURL: fixture.baseURL,
    })
    // When / Then
    await expect(
      adapter.dispatch({
        model: "unlisted-model",
        settings,
        prompt: "fixture",
        schema: z.toJSONSchema(schema),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "unsupported-model" })
    expect(fixture.requests).toHaveLength(0)
  })
  it(`${provider} rejects unsupported settings before any wire request`, async () => {
    // Given
    const fixture = await wire(200, {})
    const adapter = new ProviderAdapter({
      provider,
      apiKey: "fixture-key",
      baseURL: fixture.baseURL,
    })
    // When / Then
    await expect(
      adapter.dispatch({
        model,
        settings: { ...settings, seed: 1 },
        prompt: "fixture",
        schema: z.toJSONSchema(schema),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "unsupported-settings" })
    expect(fixture.requests).toHaveLength(0)
  })
}
