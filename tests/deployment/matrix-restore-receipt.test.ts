import { describe, expect, it } from "vitest"
import { RestoreReceiptSchema } from "./matrix-restore.ts"

const safeReceipt = {
  archive: {
    referencedBlobCount: 2,
    historicalRecords: 1,
    archiveValidated: true,
  },
  destinationOwnerId: "synthetic-owner",
  restoredStudies: 1,
  pausedJobs: 1,
  historicalGrants: 1,
  verifiedBlobCount: 2,
  allBlobsMatched: true,
  destinationCredentialPreserved: true,
  publicStudyHttp: 200,
  historicalGenerationHttp: 404,
  historicalDownloadHttp: 404,
  activeSessionHttp: 200,
  freshLoginHttp: 200,
  separateStorage: true,
  sessionCookiesDistinct: true,
  wrongPassphraseRejected: true,
  corruptCiphertextRejected: true,
}

describe("matrix restore evidence", () => {
  it("accepts only safe outcome fields when constructing a receipt", () => {
    const parsed = RestoreReceiptSchema.safeParse(safeReceipt)
    expect(parsed.success).toBe(true)
  })

  it("rejects credential and private-blob derivatives on receipt construction", () => {
    const parsed = RestoreReceiptSchema.safeParse({
      ...safeReceipt,
      preservedCredentialHash: "synthetic-credential-derivative",
      privateBlobHashes: ["synthetic-private-blob-derivative"],
      archive: { ...safeReceipt.archive, encryptedHash: "synthetic-ciphertext-digest" },
    })
    expect(parsed.success).toBe(false)
  })
})
