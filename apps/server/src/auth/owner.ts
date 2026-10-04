import type { AuthStorage } from "@reading-studio/storage"
import { z } from "zod"
import type { StudioAuth } from "./auth.ts"

const ownerInputSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(128),
})

const passwordSchema = z.string().min(1).max(128)

export class OwnerAlreadyExistsError extends Error {
  override readonly name = "OwnerAlreadyExistsError"

  constructor() {
    super("An owner is already provisioned")
  }
}

export class OwnerNotProvisionedError extends Error {
  override readonly name = "OwnerNotProvisionedError"

  constructor() {
    super("Provision the owner with the interactive owner command before starting the server")
  }
}

export type ProvisionedOwner = {
  readonly email: string
}

export function assertProvisionedOwner(storage: AuthStorage): ProvisionedOwner {
  const owner = storage.provisionedOwner()
  if (owner === null || storage.ownerCount() !== 1 || storage.authUserCount() !== 1) {
    throw new OwnerNotProvisionedError()
  }
  return { email: owner.email }
}

export function createOwnerService(storage: AuthStorage, auth: StudioAuth) {
  return {
    async provision(input: unknown): Promise<void> {
      if (storage.ownerCount() !== 0 || storage.authUserCount() !== 0) {
        throw new OwnerAlreadyExistsError()
      }
      const owner = ownerInputSchema.parse(input)
      await auth.api.signUpEmail({ body: owner })
    },

    async resetPassword(input: unknown): Promise<void> {
      const password = passwordSchema.parse(input)
      const owner = storage.provisionedOwner()
      if (owner === null) {
        throw new OwnerNotProvisionedError()
      }
      const context = await auth.$context
      const passwordHash = await context.password.hash(password)
      storage.resetCredential(owner.id, passwordHash)
    },
  } as const
}
