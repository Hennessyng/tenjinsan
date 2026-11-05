import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { LocalSubscriptionSession } from "@reading-studio/contracts"
import {
  registerSyntheticSubscriptionTool,
  SubscriptionToolRpc,
} from "@reading-studio/storage/test-support"
import { vi } from "vitest"
import { z } from "zod"
import { defaultSettings } from "../src/catalog.ts"

export type Event = {
  readonly text: string
  readonly phase?: string | number | null
  readonly threadId?: string
  readonly turnId?: string
}
const resources: { readonly directory: string; readonly rpc: SubscriptionToolRpc }[] = []
export async function closeCodexFixtures() {
  for (const { directory, rpc } of resources.splice(0)) {
    rpc.stop()
    await rpc.closed
    await rm(directory, { recursive: true, force: true })
  }
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
}
export const schema = z.strictObject({ answer: z.string(), note: z.string().optional() })
export const wireSchema = z.toJSONSchema(schema)
export async function given(input: {
  readonly items: readonly Event[]
  readonly acknowledgeLast?: boolean
  readonly closeWithoutTerminal?: boolean
}) {
  const directory = await mkdtemp(join(tmpdir(), "ten27-codex-events-"))
  const home = join(directory, "empty-home")
  await mkdir(home)
  const events = join(directory, "synthetic-events.json"),
    capture = join(directory, "frames.jsonl")
  await writeFile(events, JSON.stringify({ ...input, capture }))
  const executable = join(directory, "synthetic-tool")
  await writeFile(
    executable,
    `#!/bin/sh\nexec "${process.execPath}" "${resolve("packages/providers/tests/codex-events-fixture.cjs")}" "${events}" "$@"\n`,
    { mode: 0o700 },
  )
  vi.stubEnv("STUDIO_SUBSCRIPTION_CODEX_BINARY", executable)
  vi.stubGlobal("fetch", () => {
    throw new TypeError("Network forbidden")
  })
  registerSyntheticSubscriptionTool(executable)
  const rpc = new SubscriptionToolRpc(home, "chatgpt-subscription", true)
  resources.push({ directory, rpc })
  await rpc.initialize()
  return {
    capture,
    session: {
      rpc,
      state: LocalSubscriptionSession.parse({
        status: "disconnected",
        generation: null,
        connectionRevision: 0,
        billingRoute: "subscription-provider-managed",
        authUrl: null,
        expiresAt: null,
        catalog: "not-checked",
        account: null,
        models: [],
      }),
    },
    request: {
      model: "synthetic-model",
      settings: defaultSettings,
      schema: wireSchema,
      prompt: "Synthetic transport input",
      signal: AbortSignal.timeout(5000),
    },
  }
}
