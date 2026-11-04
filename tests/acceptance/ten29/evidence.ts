import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))
export const repoPath = (path: string) => resolve(repoRoot, path)

export async function evidenceDirectory(prefix: string): Promise<string> {
  if (!/^[a-z0-9-]+$/u.test(prefix)) throw new TypeError("Invalid evidence prefix")
  const selected = process.env["TEN29_EVIDENCE_ROOT"]
  if (selected !== undefined && !selected.trim()) throw new TypeError("Empty evidence root")
  const parent = selected === undefined ? tmpdir() : repoPath(selected)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  if (selected !== undefined) {
    try {
      await writeFile(join(parent, ".gitignore"), "*\n", { mode: 0o600, flag: "wx" })
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
      if ((await readFile(join(parent, ".gitignore"), "utf8")).trim() !== "*")
        throw new TypeError("Selected evidence root lacks a private artifact policy")
    }
  }
  return mkdtemp(join(parent, `ten29-${prefix}-`))
}
