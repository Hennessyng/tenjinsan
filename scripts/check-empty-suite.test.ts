import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { findTestFiles } from "./check-empty-suite.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function makeSuiteDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "reading-studio-empty-suite-"))
  temporaryDirectories.push(directory)
  return directory
}

describe("findTestFiles", () => {
  it("accepts a documented directory with no tests", async () => {
    const directory = await makeSuiteDirectory()
    await writeFile(join(directory, "README.md"), "Future suite.\n", "utf8")

    expect(await findTestFiles(directory)).toEqual([])
  })

  it("finds nested test and spec files", async () => {
    const directory = await makeSuiteDirectory()
    const nestedDirectory = join(directory, "nested")
    await mkdir(nestedDirectory)
    await writeFile(join(directory, "first.test.ts"), "", "utf8")
    await writeFile(join(nestedDirectory, "second.spec.tsx"), "", "utf8")

    expect(await findTestFiles(directory)).toEqual(["first.test.ts", "nested/second.spec.tsx"])
  })
})
