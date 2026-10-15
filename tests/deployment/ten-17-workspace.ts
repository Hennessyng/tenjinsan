import { execFileSync } from "node:child_process"
import { cp, mkdir, readdir, readFile, symlink } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { workspaceRoot } from "./local-fixture.ts"

export const previousRevision = "33fd965046a39de7850e512879349d7301b26a6b"

async function reuseDependencies(source: string, target: string): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(join(source, "node_modules"))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  }
  await mkdir(join(target, "node_modules"), { recursive: true })
  for (const name of entries) {
    if (name === "@reading-studio" || name.startsWith(".vite") || name === ".cache") continue
    await symlink(join(source, "node_modules", name), join(target, "node_modules", name))
  }
}

export async function copyWorkspace(directory: string, revision = "HEAD"): Promise<string> {
  const root = join(directory, "source")
  await mkdir(root)
  const archive = execFileSync("git", ["archive", revision], {
    cwd: workspaceRoot,
    maxBuffer: 64 * 1024 * 1024,
  })
  execFileSync("tar", ["-x", "-C", root], { input: archive })
  if (revision === "HEAD") {
    const names = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: workspaceRoot },
    )
      .toString()
      .split("\0")
      .filter(Boolean)
    for (const path of names) {
      const parts = path.split("/")
      if (
        parts.some(
          (part) =>
            part.startsWith(".env") ||
            [
              "data",
              "private",
              "credentials",
              "secrets",
              ".git",
              ".sisyphus",
              ".omo",
              "node_modules",
            ].includes(part),
        )
      )
        continue
      if (
        parts.length === 1 &&
        !/^(package\.json|bun\.lock|bunfig\.toml|mise\.toml|tsconfig.*\.json|biome\.json|vitest.*\.config\.ts|playwright\.config\.ts|DESIGN\.md|README\.md|\.gitignore|\.dockerignore|\.node-version)$/.test(
          path,
        )
      )
        continue
      if (
        parts.length > 1 &&
        !["apps", "packages", "scripts", "tests", "docs", "deploy"].includes(parts[0] ?? "")
      )
        continue
      await cp(join(workspaceRoot, path), join(root, path))
    }
  }
  await reuseDependencies(workspaceRoot, root)
  await mkdir(join(root, "node_modules/@reading-studio"), { recursive: true })
  for (const group of ["apps", "packages"]) {
    for (const entry of await readdir(join(root, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const name = entry.name
      const manifest = z
        .object({ name: z.string().regex(/^@reading-studio\/[a-z][a-z0-9-]*$/) })
        .parse(JSON.parse(await readFile(join(root, group, name, "package.json"), "utf8")))
      await reuseDependencies(join(workspaceRoot, group, name), join(root, group, name))
      await symlink(join(root, group, name), join(root, "node_modules", manifest.name))
    }
  }
  return root
}
