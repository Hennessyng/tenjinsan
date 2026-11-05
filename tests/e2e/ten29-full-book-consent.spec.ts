import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import { fullBookServerFixture } from "@reading-studio/server/full-book-run-fixture"
import { anonymousLocal } from "./anonymous-local.ts"
import { expectClearOfStudyBar } from "./full-book-scroll-visibility.ts"

for (const width of [375, 768, 1280])
  for (const locale of ["en", "ja"] as const) {
    test(`real fake-HTTP SQLite consent lifecycle ${locale} ${width}`, async ({ page }, info) => {
      // Given an isolated fake runtime/library and production-built UI; no external traffic is allowed.
      const control = fullBookServerFixture(
          fileURLToPath(new URL("../../apps/studio/dist", import.meta.url)),
        ),
        fixture = await control.listen(),
        errors: string[] = []
      const ja = locale === "ja"
      page.on("pageerror", (error) => errors.push(error.message))
      const labels = {
        prepare: ja ? "ドライランを準備" : "Prepare dry run",
        save: ja ? "正確な同意を保存 — 一時停止" : "Save exact consent — paused",
        resume: ja ? "承認済みの処理を1段階再開" : "Resume one approved step",
        paused: ja ? "同意を保存しました — 一時停止中" : "Consent saved — paused",
        received: ja
          ? "応答を受信済み — ローカルでの受理待ち"
          : "Reply received — awaiting local acceptance",
        unknown: ja ? "結果不明 — 所有者の判断が必要" : "Outcome unknown — owner decision required",
        failed: ja ? "分析の処理が失敗しました" : "Analysis step failed",
        complete: ja ? "完了 — 分析のみ" : "Complete — analysis only",
        cancelled: ja ? "取り消し済み — 同意を撤回" : "Cancelled — consent revoked",
        running: ja ? "実行中 — アプリ内の処理を観測" : "Running — observed application work",
        cancel: ja ? "取り消して同意を撤回" : "Cancel and revoke consent",
        newPlan: ja
          ? "新しい計画を準備（新しい同意が必要）"
          : "Prepare a new plan (new consent required)",
        refresh: ja ? "保存済みの状態を更新" : "Refresh saved state",
      }
      async function capture(name: string) {
        await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true })
        const status = page.locator(".full-book-run-panel > p").last()
        if (await status.count()) {
          const bounds = await expectClearOfStudyBar(
            status,
            info.outputPath(`${name}-last-line.bounds.json`),
          )
          await info.attach(`${name}-last-line-bounds`, {
            body: JSON.stringify(bounds),
            contentType: "application/json",
          })
          await page.screenshot({ path: info.outputPath(`${name}-last-line.png`), fullPage: true })
        }
      }
      async function startPlan() {
        const next = page.getByRole("button", { name: labels.newPlan, exact: true })
        if (await next.count()) await next.click()
        const ceiling = page.getByRole("spinbutton", {
          name: ja
            ? "提案する原典全体の試行上限（送信の承認ではありません）"
            : "Proposed total source-attempt ceiling (not approval)",
        })
        await expect(ceiling).toHaveValue("")
        await ceiling.fill("100")
        await page.getByRole("button", { name: labels.prepare, exact: true }).click()
        const save = page.getByRole("button", { name: labels.save, exact: true })
        await expect(save).toBeVisible()
        await expect(save).toBeDisabled()
        const checks = page.getByRole("checkbox")
        await expect(checks).toHaveCount(4)
        for (let index = 0; index < 4; index++) await expect(checks.nth(index)).not.toBeChecked()
        await page
          .getByRole("heading", {
            name: ja
              ? "正確な同意 — 実行は一時停止のまま"
              : "Exact consent — execution stays paused",
            exact: true,
          })
          .first()
          .scrollIntoViewIfNeeded()
        await capture("exact-identity-plan")
        await expectClearOfStudyBar(
          page
            .locator(".full-book-consent-panel dt")
            .filter({ hasText: ja ? "階層処理の方針" : "Hierarchy policy" }),
          info.outputPath("hierarchy-policy.bounds.json"),
        )
        await capture("hierarchy-policy-clear")
        for (let index = 0; index < 3; index++) {
          await checks.nth(index).scrollIntoViewIfNeeded()
          await capture(`unchecked-ack-${index}`)
          await checks.nth(index).check()
        }
        await expectClearOfStudyBar(
          page.locator(".full-book-consent-panel fieldset label").last(),
          info.outputPath("last-consent-line.bounds.json"),
        )
        await capture("last-consent-line-clear")
        await checks.nth(3).focus()
        await checks.nth(3).press("Space")
        await page.keyboard.press("Tab")
        await expect(save).toBeFocused()
        await capture("exact-consent-keyboard")
        await save.click()
        await expect(page.getByRole("heading", { name: labels.paused, exact: true })).toBeVisible()
        await expect(page.getByRole("heading", { name: labels.paused, exact: true })).toBeFocused()
        await expectClearOfStudyBar(
          page.locator(".full-book-run-panel > p").last(),
          info.outputPath("last-paused-status.bounds.json"),
        )
        await capture("last-paused-status-clear")
      }
      async function resume() {
        await Promise.all([
          page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/resume")),
          page.getByRole("button", { name: labels.resume, exact: true }).click(),
        ])
      }
      async function cancel() {
        await page.getByRole("button", { name: labels.cancel, exact: true }).click()
        await expect(
          page.getByRole("heading", { name: labels.cancelled, exact: true }),
        ).toBeVisible()
      }
      try {
        await page.setViewportSize({ width, height: 900 })
        await anonymousLocal(page, fixture, "/sources")
        await page.getByLabel("Selected study", { exact: true }).selectOption("preparation-study")
        await Promise.all([
          page.waitForResponse(
            (response) => new URL(response.url()).pathname === "/api/library-selection",
          ),
          page.getByRole("button", { name: "Select study", exact: true }).click(),
        ])
        await page.goto(
          `${fixture.origin}/sources/${fixture.revision}/setup/${fixture.setupId}?lang=${locale}`,
        )
        await page
          .getByRole("combobox", { name: ja ? "分析モード" : "Analysis mode" })
          .selectOption("full-book-test-1")
        // When exact consent is saved, work remains paused until an explicit approved step is resumed.
        await startPlan()
        expect(fixture.storage.counts().attempts).toBe(0)
        await capture("consented-paused")
        for (let index = 0; index < 5; index++) await resume()
        await expect(
          page.getByRole("heading", { name: labels.complete, exact: true }),
        ).toBeVisible()
        await capture("complete-counts")
        expect(fixture.storage.counts().attempts).toBe(5)
        const download = page.getByRole("link", {
          name: ja ? "非公開の履歴監査をダウンロード" : "Download private historical audit",
        })
        await download.scrollIntoViewIfNeeded()
        await capture("complete-export")
        const [file] = await Promise.all([page.waitForEvent("download"), download.click()])
        expect(file.suggestedFilename()).toMatch(/^full-book-history-.*\.json$/)
        control.setMode("received-unknown-usage")
        await startPlan()
        await resume()
        await expect(
          page.getByRole("heading", { name: labels.received, exact: true }),
        ).toBeVisible()
        await capture("received")
        await resume()
        expect(fixture.storage.counts().attempts).toBe(6)
        await cancel()
        control.setMode("unknown")
        await startPlan()
        await resume()
        await expect(page.getByRole("heading", { name: labels.unknown, exact: true })).toBeVisible()
        await capture("unknown-counted")
        const retry = page.getByRole("button", {
          name: ja ? "計上される再試行を承認" : "Approve a counted retry",
        })
        await expect(retry).toBeDisabled()
        await page.getByRole("checkbox").check()
        await retry.click()
        await expect(page.getByRole("heading", { name: labels.paused, exact: true })).toBeVisible()
        expect(fixture.storage.counts().attempts).toBe(7)
        control.setMode("complete")
        await resume()
        expect(fixture.storage.counts().attempts).toBe(8)
        await cancel()
        control.setMode("failed")
        await startPlan()
        await resume()
        await expect(page.getByRole("heading", { name: labels.failed, exact: true })).toBeVisible()
        await capture("failed")
        await cancel()
        control.setMode("stall")
        await startPlan()
        await page.getByRole("button", { name: labels.resume, exact: true }).click()
        await control.whenStarted()
        await page.getByRole("button", { name: labels.refresh, exact: true }).click()
        await expect(page.getByRole("heading", { name: labels.running, exact: true })).toBeVisible()
        await capture("running")
        await cancel()
        await capture("cancelled-revoked")
        // Then cancellation keeps all ten issued attempts counted, no downstream artifacts appear, and controls remain bounded.
        expect(fixture.storage.counts()).toMatchObject({
          attempts: 10,
          questions: 0,
          answers: 0,
          briefs: 0,
          outlines: 0,
          lessons: 0,
        })
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
