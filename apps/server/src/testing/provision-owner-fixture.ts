import { pathToFileURL } from "node:url"
import { openAuthStorage } from "@reading-studio/storage"
import { z } from "zod"
import { createOwnerAuth } from "../auth/auth.ts"
import { createOwnerService } from "../auth/owner.ts"

const fixtureSchema = z.object({
  AUTH_BASE_URL: z.url(),
  AUTH_SECRET: z.string().min(32),
  DATABASE_PATH: z.string().min(1),
  OWNER_EMAIL: z.email(),
  OWNER_NAME: z.string().min(1),
  OWNER_PASSWORD: z.string().min(12),
})

export async function provisionOwnerFixture(environment: NodeJS.ProcessEnv): Promise<void> {
  const fixture = fixtureSchema.parse(environment)
  const storage = openAuthStorage(fixture.DATABASE_PATH)
  try {
    const auth = createOwnerAuth(storage, {
      baseURL: fixture.AUTH_BASE_URL,
      secret: fixture.AUTH_SECRET,
      sessionExpiresIn: 60 * 60,
    })
    await createOwnerService(storage, auth).provision({
      email: fixture.OWNER_EMAIL,
      name: fixture.OWNER_NAME,
      password: fixture.OWNER_PASSWORD,
    })
  } finally {
    storage.close()
  }
}

const executablePath = process.argv[1]
if (executablePath !== undefined && import.meta.url === pathToFileURL(executablePath).href) {
  await provisionOwnerFixture(process.env)
}
