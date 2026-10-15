import { mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { epubEntries, zipFixture } from "@reading-studio/ingestion/test-support"
import { expect, it } from "vitest"
import { z } from "zod"
import {
  browserLogin,
  oldPassword,
  recoveryFixture,
  resetPasswords,
} from "./ten-17-owner-recovery-fixture.ts"
import { copyWorkspace, previousRevision } from "./ten-17-workspace.ts"

it("keeps latest credentials, content and revoked sessions on the pinned previous runtime", async () => {
  const fixture = await recoveryFixture()
  try {
    expect(fixture.tty()).toBe(0)
    await fixture.start()
    const original = await fixture.context()
    expect(await browserLogin(original, fixture.origin, oldPassword)).toBe(303)
    const epub = zipFixture(epubEntries)
    const upload = await original.request.post(`${fixture.origin}/api/imports/upload`, {
      headers: { origin: fixture.origin, "content-type": "application/epub+zip" },
      data: epub,
    })
    expect(upload.status()).toBe(202)
    const hash = z
      .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(await upload.json()).sha256
    const blob = join(
      fixture.environment["PRIVATE_DATA_ROOT"] ?? "",
      "blobs",
      hash.slice(0, 2),
      hash,
    )
    const before = await (
      await original.request.get(`${fixture.origin}/api/library-context`)
    ).json()
    const oldState = await original.storageState()
    await fixture.stop()
    expect(fixture.tty("reset-split")).toBe(0)
    await fixture.start()
    const latest = await fixture.context()
    expect(await browserLogin(latest, fixture.origin, resetPasswords["reset-split"])).toBe(303)
    expect((await latest.request.get(`${fixture.origin}/api/library-context`)).status()).toBe(200)
    await fixture.stop()
    const priorDirectory = join(fixture.fixture.directory, "pinned previous")
    await mkdir(priorDirectory)
    const prior = await copyWorkspace(priorDirectory, previousRevision)
    // This launcher builds and runs only the pinned copy's source, with the same post-reset data.
    await fixture.startPrevious(prior)
    const revoked = await fixture.browser?.newContext({ storageState: oldState })
    if (revoked === undefined) throw new TypeError("Fixture browser missing")
    expect((await revoked.request.get(`${fixture.origin}/api/library-context`)).status()).toBe(401)
    const fresh = await fixture.context()
    expect(await browserLogin(fresh, fixture.origin, oldPassword)).toBe(401)
    expect(await browserLogin(fresh, fixture.origin, resetPasswords["reset-split"])).toBe(303)
    const response = await fresh.request.get(`${fixture.origin}/api/library-context`)
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual(before)
    expect(await readFile(blob)).toEqual(epub)
  } finally {
    await fixture.close()
  }
}, 150_000)
