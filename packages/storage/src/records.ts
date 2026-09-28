import {
  ContractBoundaryError,
  ImmutableRecordError,
  StorageConstraintError,
  StorageError,
  StorageWriteError,
  StoredRecordError,
} from "./errors.ts"

type Parser<T> = {
  readonly parse: (input: unknown) => T
}

export function parseInput<T>(parser: Parser<T>, input: unknown, boundary: string): T {
  try {
    return parser.parse(input)
  } catch (error) {
    throw new ContractBoundaryError(boundary, { cause: error })
  }
}

export function readProperty(input: unknown, boundary: string, key: string): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ContractBoundaryError(boundary)
  }
  return Reflect.get(input, key)
}

export function encodeRecord(record: unknown): string {
  const encoded = JSON.stringify(record)
  if (encoded === undefined) throw new StorageWriteError("JSON record")
  return encoded
}

export function decodeRecord<T>(parser: Parser<T>, encoded: string, entity: string, id: string): T {
  try {
    const decoded: unknown = JSON.parse(encoded)
    return parser.parse(decoded)
  } catch (error) {
    throw new StoredRecordError(entity, id, { cause: error })
  }
}

export function writeRecord<T>(entity: string, id: string, write: () => T): T {
  try {
    return write()
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      throw new ImmutableRecordError(entity, id, { cause: error })
    }
    if (error instanceof Error && error.message.includes("FOREIGN KEY constraint failed")) {
      throw new StorageConstraintError(entity, { cause: error })
    }
    throw new StorageWriteError(entity, { cause: error })
  }
}
