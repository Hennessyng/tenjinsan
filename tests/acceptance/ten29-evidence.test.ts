import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { repoPath, repoRoot } from "./ten29/evidence.ts"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const helper = new URL("./ten29/evidence.ts", import.meta.url).href
function child(cwd: string, root?: string) {
  const source = `import { evidenceDirectory, repoRoot, repoPath } from ${JSON.stringify(helper)}; const directory = await evidenceDirectory("portability"); console.log(JSON.stringify({ directory, repoRoot, corpus: repoPath("tests/acceptance/ten29/corpus.json") }));`
  return z
    .object({ directory: z.string(), repoRoot: z.string(), corpus: z.string() })
    .parse(
      JSON.parse(
        execFileSync(
          process.execPath,
          ["--experimental-transform-types", "--input-type=module", "-e", source],
          { cwd, encoding: "utf8", env: { ...(root ? { TEN29_EVIDENCE_ROOT: root } : {}) } },
        ),
      ),
    )
}

it("creates a missing explicitly selected evidence parent from an unrelated cwd", async () => {
  // Given
  const cwd = await mkdtemp(join(tmpdir(), "ten29-cwd-"))
  roots.push(cwd)
  const parent = join(cwd, "missing", "nested")
  // When
  const result = child(cwd, parent)
  // Then
  expect(result.directory.startsWith(`${parent}${sep}`)).toBe(true)
  expect((await stat(result.directory)).mode & 0o777).toBe(0o700)
  expect(result.repoRoot).toBe(repoRoot)
  expect(result.corpus).toBe(repoPath("tests/acceptance/ten29/corpus.json"))
})

it("defaults to private OS-temp evidence, not repository output", async () => {
  // Given
  const cwd = await mkdtemp(join(tmpdir(), "ten29-cwd-"))
  roots.push(cwd)
  // When
  const result = child(cwd)
  roots.push(result.directory)
  // Then
  expect(isAbsolute(result.directory)).toBe(true)
  expect(result.directory.startsWith(repoRoot)).toBe(false)
  expect((await stat(result.directory)).mode & 0o777).toBe(0o700)
})

it("resolves frozen corpus paths from the module's repository root", () => {
  // Given / When / Then
  expect(repoPath("tests/acceptance/ten29/corpus.json")).toBe(
    fileURLToPath(new URL("./ten29/corpus.json", import.meta.url)),
  )
})

it("does not overwrite or ignore an existing non-private evidence policy", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ten29-policy-"))
  roots.push(cwd)
  await writeFile(join(cwd, ".gitignore"), "existing-policy\n")
  expect(() => child(cwd, cwd)).toThrow()
  expect(await readFile(join(cwd, ".gitignore"), "utf8")).toBe("existing-policy\n")
})
