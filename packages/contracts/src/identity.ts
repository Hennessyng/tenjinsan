import { createHash } from "node:crypto"
import { z } from "zod"
import { BlockId, Digest, ResourcePath, Text } from "./primitives.ts"

export const BlockIdentityInput = z
  .strictObject({
    editionHash: Digest,
    normalizerVersion: Text,
    resourcePath: ResourcePath,
    blockIdentity: Text,
  })
  .readonly()
export type BlockIdentityInput = z.infer<typeof BlockIdentityInput>

export function stableBlockId(input: BlockIdentityInput): z.infer<typeof BlockId> {
  return BlockId.parse(
    createHash("sha256")
      .update(
        JSON.stringify([
          input.editionHash,
          input.normalizerVersion,
          input.resourcePath,
          input.blockIdentity,
        ]),
      )
      .digest("hex"),
  )
}

export function contentDigest(canonicalContent: string): Digest {
  return Digest.parse(createHash("sha256").update(canonicalContent).digest("hex"))
}
