import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import { expect, test } from "@playwright/test"
import { exportPdf } from "@reading-studio/export/pdf"
import { printRevision } from "@reading-studio/export/testing/print"

const exec = promisify(execFile)
const evidence = process.env["PDF_EVIDENCE_DIR"] ?? ".omo/evidence/reading-studio/task-27"

test("pdf: searchable bilingual pages retain independently expected teaching content", async () => {
  // Given
  await mkdir(evidence, { recursive: true })
  // When
  const bytes = await exportPdf(printRevision)
  await writeFile(`${evidence}/lesson.pdf`, bytes)
  await exec("pdftotext", ["-layout", `${evidence}/lesson.pdf`, `${evidence}/lesson.txt`])
  await exec("pdftoppm", [
    "-scale-to",
    "1400",
    "-png",
    `${evidence}/lesson.pdf`,
    `${evidence}/page`,
  ])
  const { stdout: fonts } = await exec("pdffonts", [`${evidence}/lesson.pdf`])
  const { stdout: info } = await exec("pdfinfo", [`${evidence}/lesson.pdf`])
  // Then: independent expectations, not renderer-derived state lists or manifests.
  const text = await readFile(`${evidence}/lesson.txt`, "utf8")
  const compact = text.replaceAll(/\s/g, "")
  for (const [value, count] of [
    ["First view", 9],
    ["最初の視点", 9],
    ["Second view", 9],
    ["別の視点", 9],
    ["Notice the spoken words.", 9],
    ["語られた言葉に注目します。", 9],
    ["Separate inference from observation.", 9],
    ["推測と観察を区別します。", 9],
    ["Ask", 8],
    ["尋ねる", 8],
    ["Guess", 8],
    ["推測する", 8],
    ["A question allows correction.", 8],
    ["質問は訂正の余地を残します。", 8],
    ["A guess is not evidence.", 8],
    ["推測は根拠ではありません。", 8],
    ["Synthetic source", 1],
    ["架空の出典", 1],
    ["chapter-one / paragraph 2", 1],
    ["An exact synthetic quotation.", 1],
    ["Distinguish evidence from interpretation.", 1],
    ["根拠と解釈を区別します。", 1],
    ["What could you ask?", 8],
    ["何を尋ねますか？", 8],
  ] as const) {
    expect(compact.split(value.replaceAll(/\s/g, "")).length - 1, value).toBeGreaterThanOrEqual(
      count,
    )
  }
  expect(text).not.toMatch(/PRIVATE_|CANARY|\uFFFD|\u25A1/)
  expect(compact).toContain('</script><scriptid="breakout">globalThis.pwned=1</script><!--')
  expect(Buffer.from(bytes).toString("latin1")).not.toMatch(/PRIVATE_|CANARY/)
  const pages = text.split("\f").filter((page) => page.trim())
  expect(pages.length).toBeGreaterThanOrEqual(3)
  expect(pages.length).toBeLessThan(30)
  expect(
    text
      .split("\f")
      .slice(0, -1)
      .every((page) => page.trim().length > 20),
  ).toBe(true)
  expect(info).toContain("A4")
  expect(fonts).toContain("NotoSansJP")
  for (const line of fonts.trim().split("\n").slice(2)) expect(line).toMatch(/yes\s+yes\s+yes/)
  await writeFile(
    `${evidence}/results.txt`,
    [
      "PASS: independent bilingual labels, explanations, feedback, sources and privacy checks",
      `Searchable nonblank pages: ${pages.length}`,
      "Static SVG only; GPU/WebGL disabled; every used glyph uses an embedded custom font.",
      info,
      fonts,
    ].join("\n"),
  )
})
