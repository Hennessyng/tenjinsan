import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { copyLocalWorkspace } from "./local-workspace.ts"

test("copied fixture workspace excludes configuration and credential files, including public assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-copy-"))
  const source = join(root, "source")
  const parent = join(root, "target")
  try {
    await mkdir(join(source, "scripts"), { recursive: true })
    await mkdir(join(source, "node_modules"))
    await mkdir(parent)
    for (const name of ["package.json", "tsconfig.base.json"])
      await writeFile(join(source, name), "{}")
    for (const name of [
      "start-local.ts",
      "local-config.ts",
      "local-processes.ts",
      "local-log-capture.ts",
      "local-logs.ts",
      "owner.ts",
      "library.ts",
    ])
      await writeFile(join(source, "scripts", name), "")
    for (const app of ["server", "worker", "studio"]) {
      const directory = join(source, "apps", app)
      await mkdir(join(directory, "src"), { recursive: true })
      await mkdir(join(directory, "node_modules"))
      await writeFile(join(directory, "package.json"), "{}")
      await writeFile(join(directory, "src", "entry.ts"), "export {}")
      await writeFile(join(directory, "src", ".env"), "SYNTHETIC_PRIVATE_CONFIGURATION")
      await writeFile(join(directory, "src", "auth.json"), "SYNTHETIC_PRIVATE_CONFIGURATION")
    }
    const studio = join(source, "apps/studio")
    await mkdir(join(studio, "public"))
    for (const name of ["vite.config.ts", "index.html"]) await writeFile(join(studio, name), "")
    await writeFile(join(studio, "public", "favicon.svg"), "<svg/>")
    await writeFile(join(studio, "public", ".env"), "SYNTHETIC_PRIVATE_CONFIGURATION")
    await writeFile(join(studio, "public", "auth.json"), "SYNTHETIC_PRIVATE_CONFIGURATION")
    const copied = await copyLocalWorkspace(source, parent)
    expect(await readdir(join(copied, "apps/studio/public"))).toEqual(["favicon.svg"])
    expect(await readdir(join(copied, "apps/server/src"))).toEqual(["entry.ts"])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
