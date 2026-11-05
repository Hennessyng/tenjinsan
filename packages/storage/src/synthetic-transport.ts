import { createHash } from "node:crypto"
import { readFileSync, realpathSync } from "node:fs"
import { SubscriptionLoginError } from "./subscription-session-store.ts"

// Only the test-support entrypoint exports the registration function. This is an
// owned test-harness capability, not a certificate for any vendor or live route.
const fixtures = new Map<string, string>()
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")
export function registerSyntheticSubscriptionTool(path: string): void {
  fixtures.set(realpathSync(path), digest(path))
}
export function assertSyntheticSubscriptionTool(path: string): void {
  try {
    const registered = fixtures.get(realpathSync(path))
    if (!registered || registered !== digest(path))
      throw new SubscriptionLoginError("tool-unavailable")
  } catch (error) {
    if (error instanceof Error) throw new SubscriptionLoginError("tool-unavailable")
    throw error
  }
}
