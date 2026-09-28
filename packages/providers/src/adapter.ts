import { env } from "node:process"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { generateText, jsonSchema, NoObjectGeneratedError, Output } from "ai"
import { z } from "zod"
import { ProviderError, type ProviderName, type Settings, validateModel } from "./catalog.ts"

export { ProviderError } from "./catalog.ts"

const usage = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("known"),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal("unknown") }),
])
export const ProviderReceipt = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("output"), text: z.string(), usage }),
  z.strictObject({
    kind: z.literal("error"),
    code: z.enum(["rate-limited", "rejected", "unavailable", "refused", "truncated"]),
    usage,
  }),
])
export type ProviderReceipt = z.infer<typeof ProviderReceipt>
export type AdapterConfig = {
  readonly provider: ProviderName
  readonly apiKey?: string
  readonly baseURL?: string
  readonly timeoutMs?: number
}
export type StructuredRequest = {
  readonly model: string
  readonly settings: Settings
  readonly prompt: string
  readonly schema: Record<string, unknown>
  readonly signal: AbortSignal
}
export const MAX_PROVIDER_REQUEST_BYTES = 32_000

function requestBytes(body: BodyInit | null | undefined): number {
  if (typeof body !== "string") throw new ProviderError("input-limit")
  return Buffer.byteLength(body, "utf8")
}
export function configuredCredential(provider: ProviderName): string | undefined {
  switch (provider) {
    case "openai":
      return env["OPENAI_API_KEY"]?.trim() || undefined
    case "anthropic":
      return env["ANTHROPIC_API_KEY"]?.trim() || undefined
    default:
      return assertNever(provider)
  }
}
function assertNever(value: never): never {
  throw new TypeError(`Unsupported provider: ${value}`)
}

export class ProviderAdapter {
  private readonly config: AdapterConfig & { readonly apiKey: string }
  constructor(config: AdapterConfig) {
    const apiKey = config.apiKey ?? configuredCredential(config.provider)
    if (!apiKey?.trim()) throw new ProviderError("missing-credentials")
    this.config = { ...config, apiKey }
  }

  private async generate(request: StructuredRequest, wireFetch: typeof fetch) {
    validateModel(this.config.provider, request.model, request.settings)
    const { provider, apiKey, baseURL, timeoutMs } = this.config
    const model =
      provider === "openai"
        ? createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), fetch: wireFetch }).chat(
            request.model,
          )
        : createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}), fetch: wireFetch })(
            request.model,
          )
    return generateText({
      model,
      prompt: request.prompt,
      output: Output.object({ schema: jsonSchema(request.schema) }),
      maxOutputTokens: request.settings.maxOutputTokens,
      temperature: 0,
      maxRetries: 0,
      abortSignal: request.signal,
      timeout: timeoutMs ?? 30_000,
    })
  }

  async measure(request: StructuredRequest): Promise<number> {
    let bytes: number | null = null
    try {
      await this.generate(request, async (_input, init) => {
        bytes = requestBytes(init?.body)
        throw new ProviderError("input-limit")
      })
    } catch (error) {
      if (bytes !== null) return bytes
      throw error
    }
    throw new ProviderError("input-limit")
  }

  async dispatch(request: StructuredRequest): Promise<ProviderReceipt> {
    try {
      const result = await this.generate(request, (input, init) => {
        if (requestBytes(init?.body) > MAX_PROVIDER_REQUEST_BYTES)
          throw new ProviderError("input-limit")
        return fetch(input, init)
      })
      return ProviderReceipt.parse({
        kind: "output",
        text: JSON.stringify(result.output),
        usage:
          result.usage.inputTokens === undefined || result.usage.outputTokens === undefined
            ? { kind: "unknown" }
            : {
                kind: "known",
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
              },
      })
    } catch (error) {
      if (error instanceof ProviderError) throw error
      if (NoObjectGeneratedError.isInstance(error))
        return ProviderReceipt.parse({
          kind: "output",
          text: error.text,
          usage:
            error.usage?.inputTokens === undefined || error.usage.outputTokens === undefined
              ? { kind: "unknown" }
              : {
                  kind: "known",
                  inputTokens: error.usage.inputTokens,
                  outputTokens: error.usage.outputTokens,
                },
        })
      const status = z.object({ statusCode: z.number() }).safeParse(error)
      if (status.success) {
        const code =
          status.data.statusCode === 429
            ? "rate-limited"
            : status.data.statusCode >= 500
              ? "unavailable"
              : "rejected"
        return ProviderReceipt.parse({ kind: "error", code, usage: { kind: "unknown" } })
      }
      if (error instanceof Error) throw new ProviderError("outcome-unknown")
      throw error
    }
  }
}
