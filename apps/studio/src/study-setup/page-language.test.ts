import { NormalizationRevision } from "@reading-studio/contracts/source"
import { expect, it } from "vitest"
import { setupChoices, setupResult } from "./page.ts"

it("renders Japanese server setup choices without changing source paths or provider IDs", async () => {
  // Given
  const normalization = NormalizationRevision.parse({
    id: "revision-1",
    editionId: "edition-1",
    editionHash: "a".repeat(64),
    parserVersion: "2",
    normalizerVersion: "2",
    coverage: "complete",
    resources: [
      {
        path: "source.txt",
        role: "main-chapter",
        status: "included",
        blocks: [{ id: "block-1", text: "Original text" }],
      },
    ],
  })
  // When
  const result = String(
    await setupChoices({
      normalization,
      choices: [{ provider: "anthropic", model: "synthetic", label: "Anthropic synthetic" }],
      locale: "ja",
    }),
  )
  // Then
  expect(result).toContain("<h1>読書を設定する</h1>")
  expect(result).toContain('value="anthropic"')
  expect(result).toContain("source.txt")
  expect(result).not.toContain("Review transmission")
})

it("localizes result recovery and consent notice", async () => {
  // Given / When
  const result = String(
    await setupResult({
      title: "保存済み",
      message: "確認済み",
      revision: "revision-1",
      grantId: "grant-1",
      locale: "ja",
    }),
  )
  // Then
  expect(result).toContain("この設定そのものに対する許可を保存しました。")
  expect(result).toContain("設定に戻る")
  expect(result).not.toContain("Return to setup")
})
