import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { type AuthStorage, authSchema } from "@reading-studio/storage"
import { betterAuth } from "better-auth"

export type StudioAuthConfig = {
  readonly baseURL: string
  readonly secret: string
  readonly sessionExpiresIn: number
}

function createStudioAuth(storage: AuthStorage, config: StudioAuthConfig, disableSignUp: boolean) {
  return betterAuth({
    basePath: "/api/auth",
    baseURL: config.baseURL,
    database: drizzleAdapter(storage.database, {
      provider: "sqlite",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp,
      minPasswordLength: 1,
      maxPasswordLength: 128,
    },
    logger: { disabled: true },
    secret: config.secret,
    trustedOrigins: [new URL(config.baseURL).origin],
    session: {
      expiresIn: config.sessionExpiresIn,
      updateAge: 0,
    },
  })
}

export function createServerAuth(storage: AuthStorage, config: StudioAuthConfig) {
  return createStudioAuth(storage, config, true)
}

export function createOwnerAuth(storage: AuthStorage, config: StudioAuthConfig) {
  return createStudioAuth(storage, config, false)
}

export type StudioAuth = ReturnType<typeof createServerAuth>
