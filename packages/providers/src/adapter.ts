import { env } from "node:process"
import { createAnthropic } from "@ai-sdk/anthropic"
import type { Storage } from "@reading-studio/storage"
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
  readonly codex?: ReturnType<Storage["providerConnections"]["codex"]>
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
    case "codex":
      return undefined
    case "openrouter":
      return env["OPENROUTER_API_KEY"]?.trim() || undefined
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
    if (config.provider === "openai") throw new ProviderError("unsupported-model")
    const apiKey =
      config.apiKey ??
      configuredCredential(config.provider) ??
      (config.provider === "codex" && config.codex ? "subscription" : undefined)
    if (!apiKey?.trim()) throw new ProviderError("missing-credentials")
    this.config = { ...config, apiKey }
  }

  private async generate(request: StructuredRequest, wireFetch: typeof fetch) {
    validateModel(this.config.provider, request.model, request.settings)
    const { apiKey, baseURL, timeoutMs } = this.config
    const model = createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}), fetch: wireFetch })(
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
    validateModel(this.config.provider, request.model, request.settings)
    if (this.config.provider !== "anthropic")
      return (
        Buffer.byteLength(JSON.stringify(this.payload(request)), "utf8") +
        (this.config.provider === "codex" ? 512 : 0)
      )
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
      validateModel(this.config.provider, request.model, request.settings)
      if ((await this.measure(request)) > MAX_PROVIDER_REQUEST_BYTES)
        throw new ProviderError("input-limit")
      if (this.config.provider === "codex") return await this.codexDispatch(request)
      if (this.config.provider === "openrouter") {
        const choices = await ProviderAdapter.openRouterModels(
          this.config.apiKey,
          this.config.baseURL,
        )
        if (!choices.some((choice) => choice.model === request.model))
          return { kind: "error", code: "rejected", usage: { kind: "unknown" } }
        const response = await fetch(`${providerBaseURL(this.config.baseURL)}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(this.payload(request)),
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(this.config.timeoutMs ?? 30000),
          ]),
          redirect: "error",
        })
        if (!response.ok)
          return {
            kind: "error",
            code:
              response.status === 429
                ? "rate-limited"
                : response.status >= 500
                  ? "unavailable"
                  : "rejected",
            usage: { kind: "unknown" },
          }
        const result = z
          .object({
            choices: z
              .array(
                z.object({ message: z.object({ content: z.string() }), finish_reason: z.string() }),
              )
              .min(1),
            usage: z.object({
              prompt_tokens: z.number().int().nonnegative(),
              completion_tokens: z.number().int().nonnegative(),
            }),
          })
          .parse(await response.json())
        const choice = result.choices[0]
        const usage = {
          kind: "known" as const,
          inputTokens: result.usage.prompt_tokens,
          outputTokens: result.usage.completion_tokens,
        }
        return choice?.finish_reason === "stop"
          ? { kind: "output", text: choice.message.content, usage }
          : { kind: "error", code: "truncated", usage }
      }
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
      if (error instanceof Error && error.name === "CodexConnectionError")
        return { kind: "error", code: "rejected", usage: { kind: "unknown" } }
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

  static async openRouterModels(apiKey = configuredCredential("openrouter"), baseURL?: string) {
    if (!apiKey) return []
    const response = await fetch(`${providerBaseURL(baseURL)}/models/user`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    })
    if (!response.ok) throw new ProviderError("missing-credentials")
    const result = z
      .object({
        data: z.array(
          z.object({ id: z.string(), name: z.string(), supported_parameters: z.array(z.string()) }),
        ),
      })
      .parse(await response.json())
    return result.data
      .filter((model) => model.supported_parameters.includes("structured_outputs"))
      .map((model) => ({
        provider: "openrouter" as const,
        model: model.id,
        label: `OpenRouter / ${model.name}`,
      }))
  }
  private payload(request: StructuredRequest) {
    if (this.config.provider === "codex")
      return {
        input: [{ type: "text", text: request.prompt, text_elements: [] }],
        outputSchema: request.schema,
      }
    return {
      model: request.model,
      messages: [{ role: "user", content: request.prompt }],
      temperature: 0,
      max_tokens: request.settings.maxOutputTokens,
      response_format: {
        type: "json_schema",
        json_schema: { name: "study", strict: true, schema: request.schema },
      },
    }
  }
  private async codexDispatch(request: StructuredRequest): Promise<ProviderReceipt> {
    const connection = this.config.codex
    if (!connection) throw new ProviderError("missing-credentials")
    if (!(await connection.models()).some((choice) => choice.model === request.model))
      return { kind: "error", code: "rejected", usage: { kind: "unknown" } }
    const session = await connection.open()
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(this.config.timeoutMs ?? 90000),
    ])
    try {
      const started = z.object({ thread: z.object({ id: z.string() }) }).parse(
        await session.request("thread/start", {
          model: request.model,
          ephemeral: true,
          approvalPolicy: "never",
          sandbox: "read-only",
          config: { "features.shell_tool": false, web_search: "disabled" },
        }),
      )
      return await new Promise<ProviderReceipt>((resolve, reject) => {
        let text = ""
        let usage: ProviderReceipt["usage"] = { kind: "unknown" }
        const abort = () => {
          unsubscribe()
          reject(new ProviderError("outcome-unknown"))
        }
        const unsubscribe = session.subscribe((method, raw) => {
          const event = z.object({ threadId: z.string() }).passthrough().safeParse(raw)
          if (!event.success || event.data.threadId !== started.thread.id) return
          if (method === "thread/tokenUsage/updated") {
            const tokens = z
              .object({
                tokenUsage: z.object({
                  last: z.object({
                    inputTokens: z.number().int().nonnegative(),
                    outputTokens: z.number().int().nonnegative(),
                  }),
                }),
              })
              .safeParse(raw)
            if (tokens.success) usage = { kind: "known", ...tokens.data.tokenUsage.last }
          }
          if (method === "item/completed") {
            const item = z
              .object({ item: z.object({ type: z.literal("agentMessage"), text: z.string() }) })
              .safeParse(raw)
            if (item.success) text = item.data.item.text
          }
          if (method === "turn/completed") {
            const turn = z.object({ turn: z.object({ status: z.string() }) }).safeParse(raw)
            unsubscribe()
            signal.removeEventListener("abort", abort)
            resolve(
              turn.success && turn.data.turn.status === "completed" && usage.kind === "known"
                ? { kind: "output", text, usage }
                : { kind: "error", code: "rejected", usage },
            )
          }
        })
        signal.addEventListener("abort", abort, { once: true })
        if (signal.aborted) {
          abort()
          return
        }
        session
          .request("turn/start", { threadId: started.thread.id, ...this.payload(request) })
          .catch(() => {
            unsubscribe()
            signal.removeEventListener("abort", abort)
            resolve({ kind: "error", code: "rejected", usage })
          })
      })
    } finally {
      session.close()
    }
  }
}

function providerBaseURL(baseURL?: string): string {
  const value = baseURL ?? env["STUDIO_PROVIDER_BASE_URL"]
  if (value && new URL(value).hostname !== "127.0.0.1") throw new ProviderError("unauthorized")
  return value ?? "https://openrouter.ai/api/v1"
}
