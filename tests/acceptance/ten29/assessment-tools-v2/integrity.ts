import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { Sealed } from "./workflow-schema.ts"
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    )
  return value
}
export const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
export function seal(value: unknown, key: Buffer): Sealed {
  if (key.length < 32) throw new TypeError("Operator signing key too short")
  const payload = JSON.stringify(canonical(value))
  return { payload, mac: createHmac("sha256", key).update(payload).digest("hex") }
}
export function openSealed(input: unknown, key: Buffer): unknown {
  const value = Sealed.parse(input),
    expected = createHmac("sha256", key).update(value.payload).digest()
  if (!timingSafeEqual(expected, Buffer.from(value.mac, "hex")))
    throw new TypeError("Forged workflow receipt")
  return JSON.parse(value.payload)
}
