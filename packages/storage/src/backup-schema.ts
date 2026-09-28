import { Digest, EditionId, StudyId } from "@reading-studio/contracts"
import { z } from "zod"
import { TABLES, type Table } from "./backup-tables.ts"

export { TABLES } from "./backup-tables.ts"
export class BackupError extends Error {
  constructor(readonly boundary: string) {
    super(`Logical backup: ${boundary}`)
    this.name = "BackupError"
  }
}
export const OWNER_HANDLE = "historical-owner"
export const INSTALLATION_HANDLE = "historical-installation"
export const Cell = z.union([z.string(), z.number().int().safe(), z.null()])
export const Row = z.record(z.string(), Cell)
export type Row = z.infer<typeof Row>
export const History = z.strictObject({
  table: z.string(),
  row: Row,
  ownerHandle: z.literal(OWNER_HANDLE),
  studyId: StudyId.nullable(),
  editionId: EditionId.nullable(),
})
export type History = z.infer<typeof History>
export const Payload = z.strictObject({
  version: z.literal(1),
  schemaVersion: z.literal(10),
  ownerHandle: z.literal(OWNER_HANDLE),
  tables: z.array(z.strictObject({ name: z.string(), rows: z.array(Row) })),
  history: z.array(History),
  blobs: z.array(z.strictObject({ hash: Digest, bytes: z.base64() })),
})
export type Payload = z.infer<typeof Payload>
export const Archive = z.strictObject({ digest: Digest, payload: Payload })

export function columns(table: Table): readonly string[] {
  return table.columns.split(" ").map((column) => column.replace(/[?#]$/, ""))
}

export function parseRow(table: Table, input: unknown): Row {
  const shape = Object.fromEntries(
    table.columns
      .split(" ")
      .map((column) => [
        column.replace(/[?#]$/, ""),
        column.endsWith("?")
          ? z.string().nullable()
          : column.endsWith("#")
            ? z.number().int().nonnegative().safe()
            : z.string(),
      ]),
  )
  const row = Row.parse(z.strictObject(shape).parse(input))
  if (table.record && typeof row["record_json"] === "string") {
    const record = table.record.parse(JSON.parse(row["record_json"]))
    const fields = z.record(z.string(), z.json()).parse(record)
    for (const [column, value] of Object.entries(row)) {
      const key = column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
      const field = fields[key]
      if (
        key in fields &&
        typeof field !== "object" &&
        (typeof field === "boolean" ? Number(field) : field) !== value
      )
        throw new BackupError(`${table.name} column/record mismatch: ${column}`)
    }
  }
  return row
}

export function tableNamed(name: string): Table {
  const table = TABLES.find((item) => item.name === name)
  if (!table) throw new BackupError("table outside archive allowlist")
  return table
}
