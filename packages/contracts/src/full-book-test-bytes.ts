import { FullBookTestError, type FullBookTestInput } from "./full-book-test-contract.ts"
import { contentDigest } from "./identity.ts"
import { assertNever, type Digest } from "./primitives.ts"

export type FullBookByteObservation = Readonly<{
  bytes: number
  hash: Digest
  layer: "application-serialization-only"
}>

export function measureFullBookTestPayload(
  input: FullBookTestInput,
  payload: Readonly<{ kind: "application-request" | "derived-output"; serialized: string }>,
): FullBookByteObservation {
  let limit: number
  switch (payload.kind) {
    case "application-request":
      limit = input.policy.maxAppBytes
      break
    case "derived-output":
      limit = input.policy.maxOutputBytes
      break
    default:
      return assertNever(payload.kind)
  }
  const bytes = Buffer.byteLength(payload.serialized, "utf8")
  if (bytes > limit) throw new FullBookTestError("bytes")
  return Object.freeze({
    bytes,
    hash: contentDigest(payload.serialized),
    layer: "application-serialization-only",
  })
}
