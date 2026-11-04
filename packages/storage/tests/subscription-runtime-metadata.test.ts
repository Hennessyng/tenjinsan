import { fork } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SubscriptionLoginError } from "../src/subscription-session-store.ts"
import { launchSubscriptionTool } from "../src/subscription-tool-launch.ts"

vi.mock("node:child_process", () => ({
  fork: vi.fn(() => {
    throw new TypeError("Unsafe fork reached")
  }),
}))
const directories: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
describe.skipIf(process.platform === "win32")("running Node metadata boundary", () => {
  it.each([
    "missing",
    "relative",
    "unavailable",
    "directory",
    "non-executable",
    "wrong-name",
    "wrong-runtime",
  ] as const)("refuses %s runtime metadata before creating a supervisor", async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), "ten27-node-metadata-"))
    directories.push(directory)
    let execPath: string | undefined = process.execPath
    let release = process.release
    switch (kind) {
      case "missing":
        execPath = undefined
        break
      case "relative":
        execPath = "node"
        break
      case "unavailable":
        execPath = join(directory, "missing", "node")
        break
      case "directory":
        execPath = join(directory, "node")
        await mkdir(execPath)
        break
      case "non-executable":
        execPath = join(directory, "node")
        await writeFile(execPath, "", { mode: 0o600 })
        break
      case "wrong-name":
        execPath = join(directory, "other-runtime")
        await writeFile(execPath, "", { mode: 0o700 })
        break
      case "wrong-runtime":
        release = { ...release, name: "other-runtime" }
        break
      default:
        throw new TypeError(`Unexpected metadata: ${kind satisfies never}`)
    }
    vi.stubGlobal("process", { ...process, execPath, release })
    expect(() =>
      launchSubscriptionTool(join(directory, "profile"), "chatgpt-subscription"),
    ).toThrow(SubscriptionLoginError)
    expect(fork).not.toHaveBeenCalled()
  })
})
