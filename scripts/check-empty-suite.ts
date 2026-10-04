import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const testFilePattern = /\.(?:spec|test)\.[cm]?[jt]sx?$/u

async function collectTestFiles(
  root: string,
  relativeDirectory: string,
): Promise<readonly string[]> {
  const entries = await readdir(join(root, relativeDirectory), { withFileTypes: true })
  const matches = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const relativePath = join(relativeDirectory, entry.name)
      if (entry.isDirectory()) {
        return collectTestFiles(root, relativePath)
      }
      return testFilePattern.test(entry.name) ? [relativePath] : []
    }),
  )
  return matches.flat()
}

export async function findTestFiles(directory: string): Promise<readonly string[]> {
  return (await collectTestFiles(directory, "")).toSorted()
}

async function reportEmptySuite(suiteName: string, directory: string): Promise<void> {
  const testFiles = await findTestFiles(directory)
  if (testFiles.length > 0) {
    process.stderr.write(
      `${suiteName} suite contains test files but has no runner: ${testFiles.join(", ")}\n`,
    )
    process.exitCode = 1
    return
  }
  process.stdout.write(
    `not yet implemented: tests/${suiteName} contains no test files by design for checkbox 1\n`,
  )
}

const executablePath = process.argv[1]
if (executablePath !== undefined && import.meta.url === pathToFileURL(executablePath).href) {
  const suiteName = process.argv[2]
  const directory = process.argv[3]
  if (suiteName === undefined || directory === undefined) {
    throw new TypeError("Empty-suite check requires a suite name and directory")
  }
  await reportEmptySuite(suiteName, directory)
}
