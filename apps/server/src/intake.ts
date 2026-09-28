import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { chmod, copyFile, mkdir, open, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { acceptUpload } from "@reading-studio/ingestion/archive"
import { prepareSourceDocument } from "@reading-studio/ingestion/source-document"
import type { Storage } from "@reading-studio/storage"

type Receipt = Awaited<ReturnType<typeof acceptUpload>>

export function productionIntake(storage: Storage, root: string) {
  return async (receipt: Receipt, ownerId: string): Promise<void> => {
    const originalPath = join(root, receipt.id, "original.epub")
    const original = await open(originalPath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const document = await prepareSourceDocument(original, { title: "Imported EPUB" })
      if (document.edition.originalHash !== receipt.sha256)
        throw new TypeError("Import digest mismatch")
      const blob = storage.blobs.pathFor(receipt.sha256)
      await mkdir(dirname(blob), { recursive: true, mode: 0o700 })
      try {
        await copyFile(originalPath, blob, constants.COPYFILE_EXCL)
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
        if (
          createHash("sha256")
            .update(await readFile(blob))
            .digest("hex") !== receipt.sha256
        )
          throw new TypeError("Source blob hash mismatch")
      }
      await chmod(blob, 0o600)
      storage.sources.persistDocument(document)
      storage.sources.createStudy({ id: randomUUID(), ownerId, editionId: document.edition.id })
    } finally {
      await original.close()
    }
  }
}
