import { readFile } from "node:fs/promises"
import { expect, it } from "vitest"


it("TEN-13 no longer requires screen-reader, WCAG, or Safari proof", async () => {
  const report = await readFile(new URL("../../docs/ACCESSIBILITY.md", import.meta.url), "utf8")
  expect(report).toContain("Screen-reader proof, WCAG 2.2 AA, and Safari are out of scope.")
  expect(report).not.toContain("WCAG 2.2 AA is not established")
})
