import { fileURLToPath } from "node:url"
import { buildSync } from "esbuild"

export const spatialRuntime =
  buildSync({
    entryPoints: [fileURLToPath(new URL("./spatial-runtime.ts", import.meta.url))],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    minify: true,
    legalComments: "inline",
  }).outputFiles[0]?.text ?? ""
