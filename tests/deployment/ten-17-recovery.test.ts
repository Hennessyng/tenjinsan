import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { epubEntries, zipFixture } from "@reading-studio/ingestion/test-support"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  browserLogin,
  oldPassword,
  recoveryFixture,
  resetPasswords,
} from "./ten-17-owner-recovery-fixture.ts"

describe("TEN-17 real stopped owner recovery", () => {
  it.each(["reset-split", "reset-emoji"] as const)(
    "preserves exact %s input through browser login",
    async (mode) => {
      const fixture = await recoveryFixture({ defaultOrigin: mode === "reset-split" })
      try {
        expect(fixture.tty()).toBe(0)
        await fixture.start()
        const original = await fixture.context()
        expect(await browserLogin(original, fixture.origin, oldPassword)).toBe(303)
        const epub = zipFixture(epubEntries)
        const uploaded = await original.request.post(`${fixture.origin}/api/imports/upload`, {
          headers: { origin: fixture.origin, "content-type": "application/epub+zip" },
          data: epub,
        })
        expect(uploaded.status()).toBe(202)
        const hash = z
          .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })
          .parse(await uploaded.json()).sha256
        const blob = join(
          fixture.environment["PRIVATE_DATA_ROOT"] ?? "",
          "blobs",
          hash.slice(0, 2),
          hash,
        )
        expect(await readFile(blob)).toEqual(epub)
        const before = await (
          await original.request.get(`${fixture.origin}/api/library-context`)
        ).json()
        const cookies = await original.storageState()
        expect(before.studies.length).toBeGreaterThan(0)
        await fixture.stop()
        // Restart alone must not invalidate the same cookie.
        await fixture.start()
        const control = await fixture.browser?.newContext({ storageState: cookies })
        if (control === undefined) throw new TypeError("Fixture browser missing")
        expect((await control.request.get(`${fixture.origin}/api/library-context`)).status()).toBe(
          200,
        )
        await fixture.stop()
        expect(fixture.tty(mode)).toBe(0)
        await fixture.start()
        const revoked = await fixture.browser?.newContext({ storageState: cookies })
        if (revoked === undefined) throw new TypeError("Fixture browser missing")
        const denied = await revoked.request.get(`${fixture.origin}/api/library-context`)
        expect(denied.status()).toBe(401)
        expect(await denied.text()).not.toContain(before.studies[0].title)
        const fresh = await fixture.context()
        expect(await browserLogin(fresh, fixture.origin, oldPassword)).toBe(401)
        expect(await browserLogin(fresh, fixture.origin, resetPasswords[mode])).toBe(303)
        const after = await fresh.request.get(`${fixture.origin}/api/library-context`)
        expect(after.status()).toBe(200)
        expect(await after.json()).toEqual(before)
        expect(await readFile(blob)).toEqual(epub)
        if (mode === "reset-split") expect(fixture.origin).toBe("http://127.0.0.1:8787")
      } finally {
        await fixture.close()
      }
    },
    120_000,
  )

  it.each(["reset-ascii", "reset-unicode", "reset-literal", "reset-single", "reset-max"] as const)(
    "preserves accepted %s passwords with aligned relative paths",
    async (mode) => {
      const fixture = await recoveryFixture({ relativePaths: true })
      try {
        expect(fixture.tty()).toBe(0)
        expect(fixture.tty(mode)).toBe(0)
        await fixture.start()
        const context = await fixture.context()
        expect(await browserLogin(context, fixture.origin, resetPasswords[mode])).toBe(303)
        expect((await context.request.get(`${fixture.origin}/api/library-context`)).status()).toBe(
          200,
        )
      } finally {
        await fixture.close()
      }
    },
    90_000,
  )

  it.each(["reset-mismatch", "reset-empty", "reset-overlimit", "reset-interrupt"] as const)(
    "rejects %s without replacing working credentials",
    async (mode) => {
      const fixture = await recoveryFixture()
      try {
        expect(fixture.tty()).toBe(0)
        expect(fixture.tty(mode)).toBe(2)
        await fixture.start()
        const context = await fixture.context()
        expect(await browserLogin(context, fixture.origin, oldPassword)).toBe(303)
        expect((await context.request.get(`${fixture.origin}/api/library-context`)).status()).toBe(
          200,
        )
      } finally {
        await fixture.close()
      }
    },
    90_000,
  )
})
