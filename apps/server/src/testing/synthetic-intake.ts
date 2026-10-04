import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { join } from "node:path"
import type { acceptUpload } from "@reading-studio/ingestion/archive"
import { prepareSourceDocument } from "@reading-studio/ingestion/source-document"
import type { Storage } from "@reading-studio/storage"

type Receipt = Awaited<ReturnType<typeof acceptUpload>>

export function syntheticIntake(storage: Storage, root: string) {
  return async (receipt: Receipt, ownerId: string): Promise<void> => {
    await using original = await open(
      join(root, receipt.id, "original.epub"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    )
    const document = await prepareSourceDocument(original, {
      title: "Synthetic attention journal",
    })
    if (document.edition.originalHash !== receipt.sha256) {
      throw new TypeError("Synthetic intake receipt does not match original")
    }
    if (
      !document.normalization.resources.some(
        (resource) =>
          resource.status === "included" &&
          resource.blocks.some((block) => block.text.includes("TASK31_SYNTHETIC_SOURCE_v1")),
      )
    ) {
      throw new TypeError("Synthetic mode accepts only the authored test EPUB")
    }
    storage.sources.persistDocument(document)
    storage.sources.createStudy({ id: randomUUID(), ownerId, editionId: document.edition.id })
  }
}
