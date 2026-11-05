import { writeFileSync } from "node:fs"
import { basename, dirname, isAbsolute, join } from "node:path"
import type { Storage } from "@reading-studio/storage"
import { registerSyntheticSubscriptionTool } from "@reading-studio/storage/test-support"
import { bookFixtureAuthority } from "../../../apps/worker/tests/book-map-route-fixture.ts"
import { repoPath } from "./evidence.ts"

const quote = (text: string) => `'${text.replaceAll("'", "'\"'\"'")}'`
function writeRoute(directory: string, control: string) {
  writeFileSync(
    join(directory, "fake-app-server"),
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(repoPath("apps/worker/tests/managed-workflow-rpc.cjs"))} ${quote(`control:${control}`)} "$@"\n`,
    { mode: 0o700 },
  )
  registerSyntheticSubscriptionTool(join(directory, "fake-app-server"))
}
export function prepareBookRoute(fixture: {
  readonly directory: string
  readonly storage: Storage
}) {
  bookFixtureAuthority(fixture)
  writeRoute(fixture.directory, join(fixture.directory, "managed-control"))
}
export function prepareManagedRoute() {
  const binary = process.env["STUDIO_SUBSCRIPTION_CODEX_BINARY"]
  if (
    !binary ||
    !isAbsolute(binary) ||
    basename(binary) !== "fake-app-server" ||
    !basename(dirname(binary)).startsWith("ten26-managed-flow-")
  )
    throw new TypeError("Expected fixture-owned temporary RPC binary")
  writeRoute(dirname(binary), join(dirname(binary), "control"))
}
