import { cp, mkdir, symlink } from "node:fs/promises"
import { basename, join } from "node:path"

const fixtureSource = (source: string): boolean =>
  !basename(source).startsWith(".env") &&
  !["auth.json", "auth.jsonc", "secrets", "data"].includes(basename(source))

export async function copyLocalWorkspace(sourceRoot: string, parent: string): Promise<string> {
  const root = join(parent, "workspace")
  await mkdir(root)
  for (const file of ["package.json", "tsconfig.base.json"])
    await cp(join(sourceRoot, file), join(root, file))
  await mkdir(join(root, "scripts"))
  for (const file of [
    "start-local.ts",
    "local-config.ts",
    "local-processes.ts",
    "local-log-capture.ts",
    "local-logs.ts",
    "owner.ts",
    "library.ts",
  ])
    await cp(join(sourceRoot, "scripts", file), join(root, "scripts", file))
  await symlink(join(sourceRoot, "node_modules"), join(root, "node_modules"), "dir")
  for (const app of ["server", "worker", "studio"]) {
    const target = join(root, "apps", app)
    await mkdir(target, { recursive: true })
    await cp(join(sourceRoot, "apps", app, "src"), join(target, "src"), {
      recursive: true,
      filter: fixtureSource,
    })
    await cp(join(sourceRoot, "apps", app, "package.json"), join(target, "package.json"))
    await symlink(
      join(sourceRoot, "apps", app, "node_modules"),
      join(target, "node_modules"),
      "dir",
    )
  }
  for (const file of ["vite.config.ts", "index.html"])
    await cp(join(sourceRoot, "apps/studio", file), join(root, "apps/studio", file))
  await cp(join(sourceRoot, "apps/studio/public"), join(root, "apps/studio/public"), {
    recursive: true,
    filter: fixtureSource,
  })
  return root
}
