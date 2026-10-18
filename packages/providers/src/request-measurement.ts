import type { ProviderAdapter, StructuredRequest } from "./adapter.ts"

export async function measureRequest(
  request: StructuredRequest,
  adapter: Partial<Pick<ProviderAdapter, "measure">>,
): Promise<number> {
  if (adapter.measure) return adapter.measure(request)
  return (
    Buffer.byteLength(
      JSON.stringify({
        model: request.model,
        settings: request.settings,
        messages: [{ role: "user", content: request.prompt }],
        schema: request.schema,
        output_config: request.schema,
        response_format: request.schema,
      }),
      "utf8",
    ) + 4096
  )
}
