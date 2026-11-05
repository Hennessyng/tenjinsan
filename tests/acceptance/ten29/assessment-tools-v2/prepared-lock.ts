import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { openSealed } from "./integrity.ts"
export function checkPrepared(packetRoot: string) {
  const key = readFileSync(join(packetRoot, "coordinator", "operator-key"))
  const lock = z
    .strictObject({
      kind: z.literal("prepared-packet-lock"),
      assets: z
        .array(
          z.strictObject({
            path: z
              .string()
              .regex(/^(human|coordinator)\/[a-zA-Z0-9._/-]+$/u)
              .refine((value) => !value.includes("..")),
            sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          }),
        )
        .min(1),
    })
    .parse(
      openSealed(
        JSON.parse(readFileSync(join(packetRoot, "coordinator", "prepared-lock.json"), "utf8")),
        key,
      ),
    )
  for (const asset of lock.assets)
    if (
      createHash("sha256")
        .update(readFileSync(join(packetRoot, asset.path)))
        .digest("hex") !== asset.sha256
    )
      throw new TypeError("Prepared source/candidate/rubric changed")
  return key
}
