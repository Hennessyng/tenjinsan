import { openAuthStorage } from "@reading-studio/storage"
import { assertProvisionedOwner } from "./auth/owner.ts"

export { OwnerNotProvisionedError } from "./auth/owner.ts"
export { parseServerConfig, type ServerConfig, ServerConfigError } from "./config.ts"

export function assertLocalOwner(databasePath: string): void {
  const storage = openAuthStorage(databasePath)
  try {
    assertProvisionedOwner(storage)
  } finally {
    storage.close()
  }
}
