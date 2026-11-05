export function isPdfMemoryFailure(error: unknown): boolean {
  return error instanceof RangeError
}
