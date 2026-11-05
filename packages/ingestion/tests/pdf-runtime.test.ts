import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { expect, it } from "vitest"
import { runPdfProcess } from "../src/pdf-subprocess.ts"
import { pdfFixture } from "./document-fixtures.ts"

it("runs the packaged worker from a different directory without trial files or cwd assets", async () => {
  // Given
  const directory = await mkdtemp(join(tmpdir(), "pdf-portable-"))
  try {
    await cp(new URL("../src", import.meta.url), join(directory, "src"), { recursive: true })
    await symlink(
      fileURLToPath(new URL("../node_modules", import.meta.url)),
      join(directory, "node_modules"),
      "dir",
    )
    // When
    const output = await runPdfProcess(
      pdfFixture(["Portable local worker"]),
      pathToFileURL(join(directory, "src/pdf-process.mjs")),
    )
    // Then
    expect(JSON.parse(output)).toEqual({ pages: ["Portable local worker"] })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it("loads the actual local WASM with fetch disabled and rejects a 129 MiB allocation", async () => {
  // Given
  const directory = await mkdtemp(join(tmpdir(), "pdf-wasm-ceiling-"))
  try {
    const module = new URL("../src/pdf/runtime.ts", import.meta.url).href
    const memory = new URL("../src/pdf/memory.ts", import.meta.url).href
    const script = join(directory, "memory.mjs")
    await writeFile(
      script,
      `import { loadPdfRuntime } from ${JSON.stringify(module)}; import { isPdfMemoryFailure } from ${JSON.stringify(memory)}; globalThis.fetch = () => { throw new Error("unexpected-fetch") }; const runtime = await loadPdfRuntime(); let rejected = false; let classified = false; let pointer; try { pointer = runtime.mem.alloc(129 * 1024 * 1024); rejected = pointer === 0n; classified = rejected } catch (error) { if (!(error instanceof Error) || !/memory|alloc|oom/i.test(error.message)) throw error; rejected = true; classified = isPdfMemoryFailure(error) } finally { if (pointer && pointer !== 0n) runtime.mem.free(pointer) } process.stdout.write(JSON.stringify({ kind: runtime.kind, platform: runtime.platform, rejected, classified })); await runtime.destroy()`,
    )
    // When
    const output = await runPdfProcess(Buffer.from("unused"), pathToFileURL(script))
    // Then
    expect(JSON.parse(output)).toEqual({
      kind: "wasm",
      platform: "wasm32",
      rejected: true,
      classified: true,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
