import { constants } from "node:fs"
import { open, readdir } from "node:fs/promises"
import { join } from "node:path"
import { Digest, OwnerId } from "@reading-studio/contracts"
import { z } from "zod"

const Receipt = z
  .object({
    id: z.string().regex(/^import-[a-zA-Z0-9_-]+$/),
    ownerId: OwnerId,
    state: z.literal("queued"),
    sha256: Digest,
    bytes: z.number().int().nonnegative(),
  })
  .readonly()

export async function queuedImports(root: string | undefined, ownerId: string) {
  if (root === undefined) return []
  try {
    const entries = await readdir(root, { withFileTypes: true })
    const receipts: z.infer<typeof Receipt>[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^import-[a-zA-Z0-9_-]+$/.test(entry.name)) continue
      try {
        await using file = await open(
          join(root, entry.name, "queued.json"),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        )
        if ((await file.stat()).size > 16384) continue
        const receipt = Receipt.safeParse(JSON.parse(await file.readFile("utf8")))
        if (receipt.success && receipt.data.ownerId === ownerId && receipt.data.id === entry.name)
          receipts.push(receipt.data)
      } catch (error) {
        if (error instanceof SyntaxError) continue
        if (error instanceof Error && "code" in error && error.code === "ENOENT") continue
        throw error
      }
    }
    return receipts.sort((left, right) => left.id.localeCompare(right.id))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
}
