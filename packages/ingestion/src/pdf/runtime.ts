import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { createPdfRuntime } from "@embedpdf/engine-runtime"

export async function loadPdfRuntime() {
  const require = createRequire(import.meta.url)
  const path = require.resolve("@embedpdf/engine-runtime-wasm32/embedpdf.wasm")
  const runtime = await createPdfRuntime({
    prefer: "wasm",
    wasmBinary: new Uint8Array(readFileSync(path)),
  })
  if (runtime.kind !== "wasm" || runtime.platform !== "wasm32") {
    await runtime.destroy()
    throw new TypeError("wasm-runtime-required")
  }
  return runtime
}
