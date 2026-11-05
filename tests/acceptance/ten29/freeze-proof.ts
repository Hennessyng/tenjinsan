import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { z } from "zod"
import { repoPath } from "./evidence.ts"

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
const Entry = z.object({
  path: z.string(),
  originalPath: z.string(),
  oldSha256: z.string(),
  newSha256: z.string(),
  oldCanonicalSha256: z.string(),
  newCanonicalSha256: z.string(),
})
const FormatRecord = z.object({
  version: z.literal("ten29-format-only-v1"),
  formatOnly: z.literal(true),
  originalManifestSha256: z.string(),
  entries: z.array(Entry).length(3),
})

export async function verifyFrozenCorpus() {
  const manifest = await readFile(repoPath("tests/acceptance/ten29/freeze.sha256"))
  const record = FormatRecord.parse(
    JSON.parse(await readFile(repoPath("tests/acceptance/ten29/freeze.format-v1.json"), "utf8")),
  )
  assert.equal(sha(manifest), record.originalManifestSha256)
  for (const row of manifest.toString("utf8").trim().split("\n")) {
    const [digest, path] = row.split(/\s+/u)
    if (!path) throw new TypeError("Missing frozen path")
    const entry = record.entries.find((item) => item.path === path)
    const current = await readFile(repoPath(path))
    if (!entry) {
      assert.equal(sha(current), digest)
      continue
    }
    const original = await readFile(repoPath(entry.originalPath))
    assert.equal(sha(original), digest)
    assert.equal(sha(original), entry.oldSha256)
    assert.equal(sha(current), entry.newSha256)
    const before: unknown = JSON.parse(original.toString("utf8"))
    const after: unknown = JSON.parse(current.toString("utf8"))
    assert.deepStrictEqual(after, before)
    const oldCanonical = JSON.stringify(before)
    const newCanonical = JSON.stringify(after)
    if (!oldCanonical || !newCanonical) throw new TypeError("Invalid canonical JSON")
    assert.equal(newCanonical, oldCanonical)
    assert.equal(sha(oldCanonical), entry.oldCanonicalSha256)
    assert.equal(sha(newCanonical), entry.newCanonicalSha256)
    if (path.endsWith("/corpus.json")) {
      assert.ok(oldCanonical.includes("Cafe\u0301"))
      assert.ok(newCanonical.includes("Cafe\u0301"))
    }
  }
  return record
}
