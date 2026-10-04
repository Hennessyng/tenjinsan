export {
  assertInteractiveInvocation,
  OwnerCliUsageError,
} from "@reading-studio/server/owner-cli"

import { executeOwnerCli } from "@reading-studio/server/owner-cli"

if (!("VITEST" in process.env)) {
  await executeOwnerCli()
}
