import { openAuthStorage } from "@reading-studio/storage"

export { OwnerNotProvisionedError } from "./auth/owner.ts"
export { parseServerConfig, type ServerConfig, ServerConfigError } from "./config.ts"

export function assertLocalOwner(databasePath: string): void {
  const storage = openAuthStorage(databasePath)
  try {
    storage.ensureLibraryOwner()
  } finally {
    storage.close()
  }
}
