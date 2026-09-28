import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { encryptionFixture, epubEntries, zipFixture } from "@reading-studio/ingestion/test-support"
import { z } from "zod"
import { uploadHarness } from "./upload-harness.ts"

const harness = await uploadHarness()
try {
  const cases = [
    { name: "valid EPUB", bytes: zipFixture(epubEntries), status: 202 },
    {
      name: "traversal",
      bytes: zipFixture([...epubEntries, { name: "../escape.epub", text: "attack" }]),
      status: 422,
    },
    {
      name: "lying-size bomb",
      bytes: zipFixture([
        ...epubEntries,
        { name: "bomb.txt", text: "x".repeat(1_000_000), size: 1, deflate: true },
      ]),
      status: 413,
    },
    {
      name: "encrypted chapter",
      bytes: zipFixture([
        ...epubEntries,
        { name: "META-INF/encryption.xml", text: encryptionFixture("book/chapter.xhtml") },
      ]),
      status: 422,
    },
    { name: "truncated ZIP", bytes: zipFixture(epubEntries).subarray(0, -12), status: 422 },
    {
      name: "font obfuscation",
      bytes: zipFixture([
        ...epubEntries,
        { name: "fonts/a.otf", text: "obfuscated-font" },
        {
          name: "META-INF/encryption.xml",
          text: encryptionFixture("fonts/a.otf", "http://www.idpf.org/2008/embedding"),
        },
      ]),
      status: 202,
    },
  ]
  const outsideBefore = await readdir(harness.directory)
  for (const fixture of cases) {
    const before = await readdir(harness.root)
    const response = await fetch(`${harness.origin}/api/imports/upload`, {
      method: "POST",
      headers: {
        ...harness.headers,
        "content-disposition": 'attachment; filename="../../escape.epub"',
      },
      body: fixture.bytes,
    })
    const json: unknown = await response.json()
    assert.equal(response.status, fixture.status)
    if (response.status === 202) {
      const receipt = z
        .object({
          id: z.string(),
          state: z.literal("queued"),
          sha256: z.string(),
          bytes: z.number(),
        })
        .parse(json)
      assert.equal(receipt.sha256, createHash("sha256").update(fixture.bytes).digest("hex"))
      assert.deepEqual(
        await readFile(join(harness.root, receipt.id, "original.epub")),
        fixture.bytes,
      )
      assert.equal((await stat(join(harness.root, receipt.id))).mode & 0o777, 0o700)
      assert.equal(
        (await stat(join(harness.root, receipt.id, "original.epub"))).mode & 0o777,
        0o600,
      )
      assert.deepEqual(await readdir(join(harness.root, receipt.id)), [
        "original.epub",
        "queued.json",
      ])
    } else {
      assert.deepEqual(await readdir(harness.root), before)
    }
    assert.deepEqual(await readdir(harness.directory), outsideBefore)
    process.stdout.write(`${fixture.name}: HTTP ${response.status} ${JSON.stringify(json)}\n`)
  }
  process.stdout.write(
    "PASS: real owner login + HTTP uploads; hashes and original bytes match; private modes; failures cleaned; no archive entries extracted; no outside writes.\n",
  )
} finally {
  await harness.close()
}
