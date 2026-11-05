import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { z } from "zod"
import { digest, openSealed, seal } from "./integrity.ts"

const Delivery = z.strictObject({
  kind: z.string().regex(/^[a-zA-Z0-9-]+$/u),
  assets: z
    .array(
      z.strictObject({
        path: z
          .string()
          .refine((value) => /^(human|adjudicator)\//u.test(value) && !value.includes("..")),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
    )
    .min(1),
})
function verified(packetRoot: string, path: string) {
  const record = Delivery.parse(
    openSealed(
      JSON.parse(readFileSync(path, "utf8")),
      readFileSync(join(packetRoot, "coordinator", "operator-key")),
    ),
  )
  for (const asset of record.assets)
    if (
      createHash("sha256")
        .update(readFileSync(join(packetRoot, asset.path)))
        .digest("hex") !== asset.sha256
    )
      throw new TypeError(
        "Delivered source/candidate/rubric/construction changed; inspect before retry",
      )
  return record
}
export function verifyExistingDeliveries(packetRoot: string) {
  const directory = join(packetRoot, "coordinator", "delivery-receipts")
  if (existsSync(directory))
    for (const name of readdirSync(directory)) verified(packetRoot, join(directory, name))
}
export function sealDelivery(packetRoot: string, kind: string, paths: readonly string[]) {
  const directory = join(packetRoot, "coordinator", "delivery-receipts")
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const value = Delivery.parse({
    kind,
    assets: [...new Set(paths)].sort().map((path) => ({
      path: relative(packetRoot, path),
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    })),
  })
  const target = join(directory, `${value.kind}.json`)
  if (existsSync(target)) {
    if (digest(verified(packetRoot, target)) !== digest(value))
      throw new TypeError("Immutable delivery receipt differs")
    return
  }
  writeFileSync(
    target,
    JSON.stringify(
      seal(value, readFileSync(join(packetRoot, "coordinator", "operator-key"))),
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  )
}
export function requireDelivery(packetRoot: string, kind: string) {
  if (!/^[a-zA-Z0-9-]+$/u.test(kind)) throw new TypeError("Invalid delivery kind")
  const path = join(packetRoot, "coordinator", "delivery-receipts", `${kind}.json`)
  if (!existsSync(path) || verified(packetRoot, path).kind !== kind)
    throw new TypeError(
      "Complete immutable delivery required before intake; resume existing delivery if interrupted",
    )
}
