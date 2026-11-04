import { z } from "zod"
import { BackupError, type Payload, type Row } from "./backup-schema.ts"
export const portableText = (row: Row, key: string) => z.string().parse(row[key])
export const portableNumber = (row: Row, key: string) =>
  z.number().int().nonnegative().parse(row[key])
export const portableRows = (payload: Payload, name: string) =>
  payload.tables.find((table) => table.name === name)?.rows ?? []
export function portableOne(items: readonly Row[], key: string, value: string) {
  const found = items.filter((row) => row[key] === value)
  if (found.length !== 1) throw new BackupError("experimental referenced row missing or duplicated")
  const result = found[0]
  if (!result) throw new BackupError("experimental referenced row missing")
  return result
}
