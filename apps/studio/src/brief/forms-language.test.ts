import { expect, it } from "vitest"
import { briefEditor } from "./forms.ts"

it("renders Japanese form controls when the server editor uses Japanese", async () => {
  // Given
  const locale = "ja"
  // When
  const result = String(await briefEditor(null, locale))
  // Then
  expect(result).toContain('name="originalEn"')
  expect(result).toContain("最初の問い（英語）")
  expect(result).toContain("内容を確認")
  expect(result).not.toContain("Review brief")
  expect(result).toContain('value="paired" selected')
})
