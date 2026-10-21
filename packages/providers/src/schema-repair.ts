import type { ExternalAttempt } from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"
import { z } from "zod"
import { ProviderError } from "./catalog.ts"
import { RecordedProviderReceipt } from "./source-input.ts"

const RepairRule = z.enum([
  "unique-question-revision-id",
  "retain-outline-qualifications",
  "retain-outline-exclusions",
  "approved-outline-question-index",
])

type RepairIssue = {
  readonly code: z.core.$ZodIssue["code"] | "invalid-json"
  readonly path: readonly (string | number)[]
  readonly rule?: z.infer<typeof RepairRule>
}
export type SchemaRepair = { readonly format: "json-only"; readonly issues: readonly RepairIssue[] }

function propertyNames(schema: Record<string, unknown>): ReadonlySet<string> {
  const names = new Set<string>()
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    const node = z.record(z.string(), z.unknown()).safeParse(value)
    if (!node.success) return
    const propertiesKey = "properties"
    const properties = z.record(z.string(), z.unknown()).safeParse(node.data[propertiesKey])
    if (properties.success) for (const key of Object.keys(properties.data)) names.add(key)
    for (const child of Object.values(node.data)) visit(child)
  }
  visit(schema)
  return names
}

export function validateStageOutput(input: {
  readonly schema: z.ZodType
  readonly wireSchema: Record<string, unknown>
  readonly text: string
}): {
  readonly parsed: ReturnType<z.ZodType["safeParse"]>
  readonly repair: SchemaRepair | undefined
} {
  let value: unknown
  try {
    value = JSON.parse(input.text)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return {
      parsed: {
        success: false,
        error: new z.ZodError([{ code: "custom", path: [], message: "Output must be valid JSON" }]),
      },
      repair: { format: "json-only", issues: [{ code: "invalid-json", path: [] }] },
    }
  }
  const parsed = input.schema.safeParse(value)
  if (parsed.success) return { parsed, repair: undefined }
  const fields = propertyNames(input.wireSchema)
  const issues = parsed.error.issues.slice(0, 8).map((issue): RepairIssue => {
    const rule = z.object({ params: z.object({ rule: RepairRule }) }).safeParse(issue)
    return {
      code: issue.code,
      path: issue.path
        .slice(0, 16)
        .map((part) =>
          typeof part === "number"
            ? part
            : typeof part === "string" && fields.has(part)
              ? part
              : "[field]",
        ),
      ...(rule.success ? { rule: rule.data.params.rule } : {}),
    }
  })
  return { parsed, repair: { format: "json-only", issues } }
}

export function preparedSchemaRepair(input: {
  readonly execution: Pick<Storage["execution"], "getAttemptReceipt">
  readonly attempts: readonly ExternalAttempt[]
  readonly schema: z.ZodType
  readonly wireSchema: Record<string, unknown>
}): SchemaRepair | undefined {
  const latest = input.attempts.at(-1)
  switch (latest?.state) {
    case undefined:
    case "dispatching":
    case "response-received":
    case "outcome_unknown":
      return undefined
    case "prepared":
      break
    default:
      return assertNever(latest)
  }
  const previous = input.attempts.findLast((attempt) => attempt.state === "response-received")
  if (!previous) return undefined
  const body = input.execution.getAttemptReceipt(previous.id)
  if (!body) throw new ProviderError("outcome-unknown")
  const receipt = RecordedProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body)))
  switch (receipt.kind) {
    case "error":
      return undefined
    case "output":
      return validateStageOutput({
        schema: input.schema,
        wireSchema: input.wireSchema,
        text: receipt.text,
      }).repair
    default:
      return assertNever(receipt)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unknown schema repair state: ${value}`)
}

export function receivedOutputCount(
  execution: Pick<Storage["execution"], "getAttemptReceipt">,
  attempts: readonly ExternalAttempt[],
): number {
  return attempts.filter((attempt) => {
    if (attempt.state !== "response-received") return false
    const body = execution.getAttemptReceipt(attempt.id)
    return (
      body !== null &&
      RecordedProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body))).kind === "output"
    )
  }).length
}
