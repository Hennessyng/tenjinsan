import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, expect, it } from "vitest"
import { DOCUMENT_LIMITS } from "../src/document-policy.ts"
import { runPdfProcess } from "../src/pdf-subprocess.ts"
import { pdfFixture } from "./document-fixtures.ts"

const directories: string[] = []
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})
async function worker(source: string): Promise<URL> {
  const directory = await mkdtemp(join(tmpdir(), "pdf-process-test-"))
  directories.push(directory)
  const path = join(directory, "worker.mjs")
  await writeFile(path, source)
  return pathToFileURL(path)
}

it.each([
  { characters: 5, expected: { pages: ["Early"] } },
  { characters: 4, expected: { error: "limit-exceeded" } },
])(
  "checks the real PDF character boundary at $characters with a tiny fixture",
  async ({ characters, expected }) => {
    // Given
    const bytes = pdfFixture(["Early"])
    // When
    const output = await runPdfProcess(bytes, new URL("../src/pdf-process.mjs", import.meta.url), {
      ...DOCUMENT_LIMITS.pdf,
      characters,
    })
    // Then
    expect(JSON.parse(output)).toEqual(expected)
  },
)

it("kills a non-completing child at its wall-time budget", async () => {
  // Given
  const script = await worker("setInterval(() => {}, 1000)")
  // When / Then
  await expect(
    runPdfProcess(Buffer.from("synthetic"), script, { ...DOCUMENT_LIMITS.pdf, milliseconds: 50 }),
  ).rejects.toMatchObject({ code: "limit-exceeded", cause: { killed: true, signal: "SIGKILL" } })
})

it("bounds actual child stdout without allocating a hostile document", async () => {
  // Given
  const script = await worker('process.stdout.write("x".repeat(4096))')
  // When / Then
  await expect(
    runPdfProcess(Buffer.from("synthetic"), script, { ...DOCUMENT_LIMITS.pdf, outputBytes: 1024 }),
  ).rejects.toMatchObject({
    code: "limit-exceeded",
    cause: { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" },
  })
})

it("classifies SIGABRT like a heap abort without exhausting the heap", async () => {
  // Given
  const script = await worker('process.kill(process.pid, "SIGABRT")')
  // When / Then
  await expect(runPdfProcess(Buffer.from("synthetic"), script)).rejects.toMatchObject({
    code: "limit-exceeded",
    cause: { signal: "SIGABRT" },
  })
})

it("passes the real V8 heap ceiling to the child", async () => {
  // Given
  const script = await worker("process.stdout.write(JSON.stringify(process.execArgv))")
  // When
  const output = await runPdfProcess(Buffer.from("synthetic"), script)
  // Then
  expect(JSON.parse(output)).toContain("--max-old-space-size=128")
})
