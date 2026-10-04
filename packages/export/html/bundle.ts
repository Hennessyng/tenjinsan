import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { buildSync } from "esbuild"

export class ExportBuildError extends Error {
  override readonly name = "ExportBuildError"
}

const bundles = new Map<boolean, string>()

export function exportRuntime(spatial: boolean): string {
  const cached = bundles.get(spatial)
  if (cached !== undefined) return cached
  const result = buildSync({
    entryPoints: [
      fileURLToPath(new URL(spatial ? "./spatial-runtime.ts" : "./runtime.ts", import.meta.url)),
    ],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "es2022",
    minify: true,
    legalComments: "inline",
    metafile: true,
  })
  const output = result.outputFiles[0]?.text
  if (!output || Object.values(result.metafile.outputs).some((file) => file.imports.length > 0)) {
    throw new ExportBuildError("Offline runtime must be a single bundled script")
  }
  bundles.set(spatial, output)
  return output
}

export function threeLicense(): string {
  return readFileSync(new URL("../LICENSE", import.meta.resolve("three")), "utf8")
}
