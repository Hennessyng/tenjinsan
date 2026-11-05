import { existsSync, readdirSync, realpathSync } from "node:fs"
import { join } from "node:path"

export function installedPdfPackages(roots: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const names = new Set<string>()
  const visit = (directory: string) => {
    if (!existsSync(directory)) return
    const actual = realpathSync(directory)
    if (seen.has(actual)) return
    seen.add(actual)
    if (seen.size > 20000) throw new RangeError("dependency tree scan limit")
    for (const name of readdirSync(directory)) {
      if (name === "@embedpdf")
        for (const member of readdirSync(join(directory, name))) names.add(`@embedpdf/${member}`)
      if (name === ".bun" || name === ".pnpm") {
        for (const member of readdirSync(join(directory, name)))
          visit(join(directory, name, member, "node_modules"))
      } else if (name.startsWith("@")) {
        for (const member of readdirSync(join(directory, name)))
          visit(join(directory, name, member, "node_modules"))
      } else if (!name.startsWith(".")) visit(join(directory, name, "node_modules"))
    }
  }
  for (const root of roots) visit(root)
  return [...names].sort()
}
