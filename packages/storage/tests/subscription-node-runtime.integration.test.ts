import { realpathSync } from "node:fs"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { SubscriptionToolRpc } from "../src/subscription-tool-rpc.ts"

const resources: { readonly directory: string; readonly rpcs: SubscriptionToolRpc[] }[] = []
afterEach(async () => {
  for (const { directory, rpcs } of resources.splice(0)) {
    for (const rpc of rpcs) rpc.stop()
    await Promise.all(rpcs.map((rpc) => rpc.closed))
    await rm(directory, { recursive: true, force: true })
  }
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "ten27-node-runtime-"))
  const rpcs: SubscriptionToolRpc[] = []
  resources.push({ directory, rpcs })
  const hostile = join(directory, "hostile"),
    home = join(directory, "profile")
  await mkdir(hostile)
  await mkdir(home)
  const source = await readFile(
    resolve("packages/storage/tests/subscription-initialize-fixture.cjs"),
    "utf8",
  )
  const binary = join(directory, "explicit-codex.cjs")
  await writeFile(binary, source, { mode: 0o700 })
  await writeFile(join(hostile, "node"), "#!/bin/sh\nexec /bin/sleep 30\n", { mode: 0o700 })
  await writeFile(join(hostile, "codex"), source, { mode: 0o700 })
  vi.stubEnv("PATH", hostile)
  vi.stubEnv("STUDIO_SUBSCRIPTION_CODEX_BINARY", binary)
  for (const key of ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "CODEX_API_KEY"])
    vi.stubEnv(key, "synthetic-secret-must-stay-in-parent")
  const network = vi.fn(async () => {
    throw new TypeError("Network forbidden")
  })
  vi.stubGlobal("fetch", network)
  return { directory, home, rpcs, network }
}
describe.skipIf(process.platform === "win32")("isolated Node-shebang startup", () => {
  it.each(["hostile-shim", "missing-path", "empty-path"] as const)(
    "initializes through the trusted running Node with %s",
    async (condition) => {
      const { home, rpcs, network } = await fixture()
      const trustedExecutable = realpathSync(process.execPath)
      switch (condition) {
        case "missing-path":
          vi.stubEnv("PATH", undefined)
          break
        case "empty-path":
          vi.stubEnv("PATH", "")
          break
        case "hostile-shim":
          break
        default:
          throw new TypeError(`Unexpected PATH condition: ${condition satisfies never}`)
      }
      const inheritedPath = process.env["PATH"]
      const expectedPath = inheritedPath
        ? `${dirname(trustedExecutable)}${delimiter}${inheritedPath}`
        : dirname(trustedExecutable)
      const rpc = new SubscriptionToolRpc(home)
      rpcs.push(rpc)
      const result = await rpc.request(
        "initialize",
        {
          clientInfo: { name: "tenjinsan_local", version: "1.0.0" },
          capabilities: { experimentalApi: true },
        },
        2000,
      )
      expect(
        z
          .object({
            nodeExecutable: z.string(),
            home: z.string(),
            codexHome: z.string(),
            path: z.string(),
            profileEmpty: z.boolean(),
            workspaceEmpty: z.boolean(),
            credentialInherited: z.boolean(),
            methods: z.array(z.string()),
          })
          .parse(result),
      ).toEqual({
        nodeExecutable: trustedExecutable,
        home,
        codexHome: home,
        path: expectedPath,
        profileEmpty: true,
        workspaceEmpty: true,
        credentialInherited: false,
        methods: ["initialize"],
      })
      rpc.stop()
      await rpc.closed
      await expect(access(rpc.cwd)).rejects.toMatchObject({ code: "ENOENT" })
      expect(network).not.toHaveBeenCalled()
    },
  )
  it("does not fall back to a working PATH launcher when the explicit binary is missing", async () => {
    const { directory, home, rpcs, network } = await fixture()
    vi.stubEnv("STUDIO_SUBSCRIPTION_CODEX_BINARY", join(directory, "missing-codex"))
    const rpc = new SubscriptionToolRpc(home)
    rpcs.push(rpc)
    await expect(rpc.request("initialize", {}, 2000)).rejects.toMatchObject({
      code: "tool-unavailable",
    })
    expect(network).not.toHaveBeenCalled()
  })
})
