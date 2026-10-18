import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { expect, it } from "vitest"
import { exportPdf } from "../pdf/index.ts"
import { approved } from "./fixture.ts"

const run = promisify(execFile)

it("keeps fixed PDF interface languages and both approved lesson languages in extracted text", async () => {
  // Given
  const revision = approved()
  const root = join(
    process.cwd(),
    ".sisyphus/runs/TEN-19/evidence/pdf-languages",
    crypto.randomUUID(),
  )
  await mkdir(root, { recursive: true })
  for (const ui of ["en", "ja", "en+ja"] as const) {
    // When
    const bytes = await exportPdf(revision, { ui })
    const file = join(root, `${ui.replace("+", "-")}.pdf`)
    await writeFile(file, bytes)
    const { stdout } = await run("pdftotext", ["-layout", file, "-"], {
      maxBuffer: 4 * 1024 * 1024,
    })
    await writeFile(`${file}.txt`, stdout)
    const normalized = stdout.replace(/\s/g, "")
    // Then
    expect(normalized).toContain(revision.projection.title.en.replace(/\s/g, ""))
    expect(normalized).toContain(revision.projection.title.ja.replace(/\s/g, ""))
    if (ui !== "ja") expect(normalized).toContain("Sourcesappendix")
    if (ui !== "en") expect(normalized).toContain("出典付録")
    if (ui === "ja") expect(normalized).not.toContain("Sourcesappendix")
    if (ui === "en") expect(normalized).not.toContain("出典付録")
  }
  console.log(`TEN-19 PDF language evidence: ${root}`)
}, 180_000)
