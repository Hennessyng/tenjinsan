import { z } from "zod"

export const CodexOutputFormat = z.enum(["native-json-schema", "app-validated-json"])
export type CodexOutputFormat = z.infer<typeof CodexOutputFormat>

function hasOptionalProperties(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasOptionalProperties)
  const node = z.record(z.string(), z.unknown()).safeParse(value)
  if (!node.success) return false
  const properties = z.record(z.string(), z.unknown()).safeParse(node.data["properties"])
  const required = z.array(z.string()).safeParse(node.data["required"])
  if (
    properties.success &&
    Object.keys(properties.data).some((key) => !required.success || !required.data.includes(key))
  )
    return true
  return Object.values(node.data).some(hasOptionalProperties)
}
export function codexOutputFormat(schema: Record<string, unknown>): CodexOutputFormat {
  return hasOptionalProperties(schema) ? "app-validated-json" : "native-json-schema"
}
