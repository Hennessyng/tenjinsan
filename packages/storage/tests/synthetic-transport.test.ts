import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { SubscriptionToolRpc } from "../src/subscription-tool-rpc.ts"
import {
  assertSyntheticSubscriptionTool,
  registerSyntheticSubscriptionTool,
} from "../src/synthetic-transport.ts"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
it("refuses an unregistered or changed transport without executing it", () => {
  const directory = mkdtempSync(join(tmpdir(), "ten29-transport-scope-"))
  directories.push(directory)
  const binary = join(directory, "owned-fixture")
  writeFileSync(binary, "synthetic-non-executable-fixture")
  expect(() => assertSyntheticSubscriptionTool(binary)).toThrow("tool-unavailable")
  const previous = process.env["STUDIO_SUBSCRIPTION_CODEX_BINARY"]
  process.env["STUDIO_SUBSCRIPTION_CODEX_BINARY"] = binary
  try {
    expect(
      () => new SubscriptionToolRpc(join(directory, "empty-home"), "chatgpt-subscription", true),
    ).toThrow("tool-unavailable")
  } finally {
    if (previous === undefined) delete process.env["STUDIO_SUBSCRIPTION_CODEX_BINARY"]
    else process.env["STUDIO_SUBSCRIPTION_CODEX_BINARY"] = previous
  }
  registerSyntheticSubscriptionTool(binary)
  expect(() => assertSyntheticSubscriptionTool(binary)).not.toThrow()
  writeFileSync(binary, "changed-fixture")
  expect(() => assertSyntheticSubscriptionTool(binary)).toThrow("tool-unavailable")
})
