import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { z } from "zod"

const Hash = z.string().regex(/^[a-f0-9]{64}$/)
const Archive = z.strictObject({
  digest: Hash,
  payload: z.strictObject({
    version: z.literal(1),
    schemaVersion: z.literal(10),
    ownerHandle: z.literal("historical-owner"),
    tables: z.array(z.object({ name: z.string(), rows: z.array(z.unknown()) })),
    history: z.array(z.unknown()),
    blobs: z.array(z.object({ hash: Hash, bytes: z.base64() })),
  }),
})

const archivePath = process.argv[2]
if (!archivePath) throw new TypeError("Encrypted archive path required")
const ciphertext = readFileSync(archivePath)
const decrypted = spawnSync("age", ["--decrypt", archivePath], {
  stdio: ["pipe", "pipe", "inherit"],
  maxBuffer: 512 * 1024 * 1024,
  timeout: 120_000,
})
if (decrypted.status !== 0) throw new TypeError("Archive decryption failed")
const text = decrypted.stdout.toString("utf8")
for (const canary of [
  "owner@example.test",
  "correct horse battery staple",
  "auth_users",
  "auth_accounts",
  "auth_sessions",
  "auth_verifications",
  "wire-only-test-credential",
]) {
  if (text.includes(canary)) throw new TypeError("Authentication or provider canary in archive")
}
const archive = Archive.parse(JSON.parse(text))
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")
if (digest(JSON.stringify(archive.payload)) !== archive.digest)
  throw new TypeError("Archive manifest hash mismatch")
for (const blob of archive.payload.blobs)
  if (digest(Buffer.from(blob.bytes, "base64")) !== blob.hash)
    throw new TypeError("Encrypted archive referenced blob hash mismatch")
process.stdout.write(
  `ARCHIVE_CHECK ${JSON.stringify({
    encryptedHash: digest(ciphertext),
    manifestHash: archive.digest,
    referencedBlobCount: archive.payload.blobs.length,
    historicalRecords: archive.payload.history.length,
  })}\n`,
)
