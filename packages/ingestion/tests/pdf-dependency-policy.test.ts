import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"
import { assertWasmOnlyPackages } from "../src/pdf/dependency-policy.ts"
import { installedPdfPackages } from "../src/pdf/dependency-tree.ts"

it("permits the selected runtime, WASM payload and existing unrelated dependencies", () => {
  // Given / When / Then
  expect(() =>
    assertWasmOnlyPackages([
      "@embedpdf/engine-runtime",
      "@embedpdf/engine-runtime-wasm32",
      "detect-libc",
      "better-sqlite3",
    ]),
  ).not.toThrow()
})
it("detects a forbidden payload in an installed synthetic store, not only lock records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pdf-native-tree-"))
  try {
    await mkdir(join(directory, ".bun/entry/node_modules/@embedpdf/engine-runtime-linux-x64"), {
      recursive: true,
    })
    const names = installedPdfPackages([directory])
    expect(names).toContain("@embedpdf/engine-runtime-linux-x64")
    expect(() => assertWasmOnlyPackages(names)).toThrow(/excluded PDF runtime package/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it("guards the current lock and local installed dependency tree", () => {
  const script = fileURLToPath(new URL("../../../scripts/check-pdf-runtime.ts", import.meta.url))
  const result = JSON.parse(
    execFileSync(process.execPath, ["--experimental-transform-types", script], {
      encoding: "utf8",
    }),
  )
  expect(result.status).toBe("PASS")
  expect(result.installedPdfPackages).toEqual([
    "@embedpdf/engine-runtime",
    "@embedpdf/engine-runtime-wasm32",
  ])
  expect(result.linuxFrozenInstall).toMatch(/UNVERIFIED/u)
})
it.each([
  "@embedpdf/engine-runtime-linux-x64",
  "@embedpdf/engine-runtime-darwin-arm64",
  "@embedpdf/engine-runtime-cloud",
  "parent/@embedpdf/engine-runtime-win32-x64",
])("rejects the offending package record %s", (name) => {
  // Given / When / Then
  expect(() => assertWasmOnlyPackages(["@embedpdf/engine-runtime-wasm32", name])).toThrow(
    /excluded PDF runtime package/u,
  )
})
