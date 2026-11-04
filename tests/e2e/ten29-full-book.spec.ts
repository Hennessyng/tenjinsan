import { expect, test } from "@playwright/test"
import { sourceViewerFixture } from "@reading-studio/server/source-viewer-fixture"
import { z } from "zod"
import { anonymousLocal, proxyAnonymousApi, selectAnonymousStudy } from "./anonymous-local.ts"
import {
  attachBrowserManaged,
  browserManagedChoice,
  browserManagedOptions,
} from "./anonymous-managed-setup.ts"
import { syntheticFullBookReview } from "./full-book-review-fixture.ts"

for (const width of [375, 768, 1280])
  for (const locale of ["en", "ja"] as const) {
    test(`explicit full-book dry-run lifecycle ${locale} ${width}`, async ({ page }, info) => {
      // Given a synthetic-only library and production-built studio, with all external traffic fenced.
      const fixture = attachBrowserManaged(
        await sourceViewerFixture({ ...browserManagedOptions, providerAvailable: false }),
      )
      const errors: string[] = [],
        requests: string[] = []
      page.on("pageerror", (error) => errors.push(error.message))
      let refuse = false
      try {
        await page.setViewportSize({ width, height: 900 })
        await proxyAnonymousApi(page, fixture)
        await anonymousLocal(page, fixture, "http://127.0.0.1:4173/sources")
        await selectAnonymousStudy(page)
        const draft = await page.request.post(
          `${fixture.origin}/api/study-setup/revision-fixture`,
          { headers: { origin: fixture.origin }, data: browserManagedChoice },
        )
        expect(draft.status()).toBe(201)
        const { setupId } = z.object({ setupId: z.string() }).parse(await draft.json())
        await page.route("**/api/full-book-test/**", async (route) => {
          const path = new URL(route.request().url()).pathname
          requests.push(path)
          if (!path.endsWith("/prepare") && !path.endsWith("/review"))
            throw new TypeError("Unexpected sending/consent endpoint")
          await route.fulfill({
            status: refuse ? 409 : 200,
            json: refuse
              ? { error: "review-stale", transmission: "not-sent" }
              : { ...syntheticFullBookReview, setupId },
          })
        })
        await page.goto(
          `http://127.0.0.1:4173/sources/revision-fixture/setup/${setupId}?lang=${locale}`,
        )
        const mode = page.getByRole("combobox", {
          name: locale === "ja" ? "分析モード" : "Analysis mode",
        })
        await expect(mode).toHaveValue("")
        await page.screenshot({ path: info.outputPath("saved-mode.png"), fullPage: true })
        expect(requests).toEqual([])
        // When explicit experimental mode is chosen and prepared with a proposed ceiling.
        await mode.selectOption("full-book-test-1")
        const send = page.getByRole("button", {
          name: locale === "ja" ? "送信" : "Send",
          exact: true,
        })
        await expect(send).toBeDisabled()
        await page
          .getByRole("heading", {
            name:
              locale === "ja"
                ? "書籍全体の実験分析を準備"
                : "Prepare experimental full-book analysis",
          })
          .scrollIntoViewIfNeeded()
        await page.screenshot({ path: info.outputPath("selected.png"), fullPage: true })
        await page
          .getByRole("spinbutton", {
            name:
              locale === "ja"
                ? "提案する原典全体の試行上限（送信の承認ではありません）"
                : "Proposed total source-attempt ceiling (not approval)",
          })
          .fill("300")
        await page
          .getByRole("button", { name: locale === "ja" ? "ドライランを準備" : "Prepare dry run" })
          .click()
        const budget = page.getByRole("heading", {
          name: locale === "ja" ? "原典全体で共有する試行予算" : "Shared source budget",
        })
        await expect(budget).toBeVisible()
        await expect(send).toBeDisabled()
        await budget.scrollIntoViewIfNeeded()
        await page.screenshot({ path: info.outputPath("prepared.png"), fullPage: true })
        await page
          .getByRole("heading", {
            name:
              locale === "ja"
                ? "抽出範囲と実際の除外項目"
                : "Extraction coverage and exact omissions",
          })
          .scrollIntoViewIfNeeded()
        await page.screenshot({ path: info.outputPath("omissions.png"), fullPage: true })
        await send.scrollIntoViewIfNeeded()
        await page.screenshot({ path: info.outputPath("disabled-actions.png"), fullPage: true })
        expect(
          await page
            .locator(".full-book-budget dd")
            .evaluateAll((elements) =>
              elements.every((element) => element.scrollWidth <= element.clientWidth),
            ),
        ).toBe(true)
        refuse = true
        await page
          .getByRole("button", {
            name: locale === "ja" ? "この確認を再チェック" : "Recheck this review",
          })
          .click()
        await expect(page.getByRole("alert")).toBeVisible()
        await expect(page.getByRole("alert")).toBeFocused()
        await expect(budget).toHaveCount(0)
        await page.screenshot({ path: info.outputPath("stale.png"), fullPage: true })
        await page
          .getByRole("button", { name: locale === "ja" ? "取り消す" : "Cancel", exact: true })
          .click()
        // Then only two grant-free endpoints were used and the ordinary review survives cancellation/reload.
        await expect(mode).toHaveValue("")
        await mode.focus()
        await expect(mode).toBeFocused()
        await page.screenshot({ path: info.outputPath("cancelled-focus.png"), fullPage: true })
        await page.reload()
        await expect(mode).toHaveValue("")
        expect(requests).toEqual([
          `/api/full-book-test/${setupId}/prepare`,
          `/api/full-book-test/${setupId}/review`,
        ])
        expect(fixture.storage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        expect(errors).toEqual([])
      } finally {
        await page.context().close()
        await fixture.close()
      }
    })
  }
