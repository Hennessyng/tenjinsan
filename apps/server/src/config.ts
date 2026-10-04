import { z } from "zod"

export type ServerConfig = {
  readonly authBaseURL: string
  readonly authSecret: string
  readonly databasePath: string
  readonly host: string
  readonly port: number
  readonly sessionExpiresIn: number
  readonly trustedOrigins: readonly string[]
  readonly trustProxy: boolean
}

export class ServerConfigError extends Error {
  readonly fields: readonly string[]

  constructor(fields: readonly string[]) {
    super(`Invalid server configuration: ${fields.join(", ")}`)
    this.name = "ServerConfigError"
    this.fields = fields
  }
}

const httpOriginSchema = z.url().refine((value) => {
  const url = new URL(value)
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === ""
  )
})

const serverConfigSchema = z.object({
  AUTH_BASE_URL: httpOriginSchema,
  AUTH_SECRET: z.string().min(32),
  DATABASE_PATH: z.string().trim().min(1),
  SERVER_HOST: z.string().trim().min(1),
  SERVER_PORT: z.coerce.number().int().min(1).max(65_535),
  TRUSTED_ORIGINS: z
    .string()
    .transform((value) => value.split(",").map((origin) => origin.trim()))
    .pipe(z.array(httpOriginSchema).min(1))
    .transform((origins) => origins.map((origin) => new URL(origin).origin)),
  TRUST_PROXY: z.enum(["0", "1"]),
})

export function parseServerConfig(environment: NodeJS.ProcessEnv): ServerConfig {
  const result = serverConfigSchema.safeParse(environment)
  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => {
        const field = issue.path[0]
        return typeof field === "string" ? field : "configuration"
      })
      .toSorted()
    throw new ServerConfigError(fields)
  }
  return {
    authBaseURL: result.data.AUTH_BASE_URL,
    authSecret: result.data.AUTH_SECRET,
    databasePath: result.data.DATABASE_PATH,
    host: result.data.SERVER_HOST,
    port: result.data.SERVER_PORT,
    sessionExpiresIn: 60 * 60 * 24 * 7,
    trustedOrigins: result.data.TRUSTED_ORIGINS,
    trustProxy: result.data.TRUST_PROXY === "1",
  }
}
