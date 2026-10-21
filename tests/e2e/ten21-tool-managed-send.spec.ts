import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, test } from "@playwright/test"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"

for (const provider of ["chatgpt-subscription", "grok-subscription"] as const) {
  for (const width of [375, 768, 1280]) {
    test(`${provider} reviews tool-managed limits and completes a persisted analysis at ${width}px`, async ({
      page,
    }) => {
      // Given
      const directory = await mkdtemp(join(tmpdir(), "ten21-send-browser-"))
      const binary = join(directory, "tool-fixture")
      const kind = provider === "chatgpt-subscription" ? "codex" : "grok"
      const name = provider === "chatgpt-subscription" ? "ChatGPT" : "Grok"
      const key =
        provider === "chatgpt-subscription"
          ? "STUDIO_SUBSCRIPTION_CODEX_BINARY"
          : "STUDIO_SUBSCRIPTION_GROK_BINARY"
      const previous = process.env[key]
      await writeFile(
        binary,
        `#!/bin/sh\nexec "${process.execPath}" "${resolve("packages/storage/tests/subscription-execution-fixture.cjs")}" kind:${kind} "$@"\n`,
        { mode: 0o700 },
      )
      process.env[key] = binary
      const fixture = await sourceViewerFixture({
        studioAssets: true,
        serverHost: "127.0.0.1",
        executeLocalSubscriptions: true,
      })
      const evidence = ".omo/evidence/TEN-21/tool-managed-send"
      await mkdir(evidence, { recursive: true })
      const external: string[] = []
      const errors: string[] = []
      page.on("pageerror", (error) => errors.push(error.name))
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue()
        external.push(new URL(route.request().url()).hostname)
        return route.abort()
      })
      try {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`${fixture.origin}/sources/revision-fixture/setup`)
        await page.getByRole("button", { name: `Connect ${name}`, exact: true }).click()
        const choices = page.getByRole("combobox", { name: "Provider and model" })
        await expect(choices).toContainText(`${provider} / Study model`)
        await choices.selectOption({ label: `${provider} / Study model` })
        await page.getByRole("radio", { name: "All main chapters", exact: true }).check()
        await page.getByRole("button", { name: "Review transmission", exact: true }).click()
        await expect(page.getByRole("region", { name: "Tool-managed execution" })).toBeVisible()
        await page.getByRole("region", { name: "Tool-managed execution" }).scrollIntoViewIfNeeded()
        await page.screenshot({
          path: `${evidence}/${kind}-${width}-review.png`,
          fullPage: true,
          mask: [page.locator(".subscription-observations dd, code, .metadata, small")],
        })
        // When
        await page.getByRole("button", { name: "Send", exact: true }).click()
        await expect(page.getByRole("heading", { name: "Transmission approved" })).toBeVisible()
        await fixture.localWorker.settled()
        await page.getByRole("link", { name: "View analysis progress", exact: true }).click()
        await expect(page).toHaveURL(/\/jobs\?setup=/)
        // Then
        await expect(
          page.getByRole("heading", { name: "Analysis · Completed", exact: true }).first(),
        ).toBeVisible()
        await expect(
          page.getByRole("region", { name: "Tool-managed execution" }).first(),
        ).toBeVisible()
        await page
          .getByRole("heading", { name: "Analysis · Completed", exact: true })
          .first()
          .scrollIntoViewIfNeeded()
        await page.screenshot({
          path: `${evidence}/${kind}-${width}-completed.png`,
          fullPage: true,
          mask: [page.locator("code, .metadata, small")],
        })
        expect(fixture.localWorker.errors).toEqual([])
        const owner = fixture.storage.sources.listStudiesByEdition("edition-fixture")[0]
        if (!owner) throw new TypeError("Missing fixture owner")
        const current = fixture.storage.revisions.current({
          studyId: owner.id,
          ownerId: owner.ownerId,
        })
        expect(current.analysis?.status).toBe("successful")
        expect(current.analysis?.chapters.every((chapter) => chapter.status === "complete")).toBe(
          true,
        )
        expect(external).toEqual([])
        expect(errors).toEqual([])
      } finally {
        await fixture.close()
        if (previous === undefined) delete process.env[key]
        else process.env[key] = previous
        await rm(directory, { recursive: true, force: true })
      }
    })
  }
}
