import { once } from "node:events"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { getRequestListener } from "@hono/node-server"
import { fixtureOutlineProvider } from "@reading-studio/generation/outline"
import { openAuthStorage, openStorage } from "@reading-studio/storage"
import { createApp } from "../app.ts"
import { createOwnerAuth, createServerAuth } from "../auth/auth.ts"
import { createOwnerService } from "../auth/owner.ts"
import { loadStudioAssets } from "../studio-assets.ts"

export async function sourceViewerFixture(options?: {
  readonly providerAvailable?: boolean
  readonly studioAssets?: boolean
}) {
  const directory = await mkdtemp(join(tmpdir(), "source-viewer-"))
  const databasePath = join(directory, "studio.sqlite")
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new TypeError("Missing address")
  const origin = `http://127.0.0.1:${address.port}`
  const authStorage = openAuthStorage(databasePath)
  const config = {
    baseURL: origin,
    secret: "source-viewer-test-secret-at-least-32-characters",
    sessionExpiresIn: 3600,
  }
  const credentials = { email: "reader@example.test", password: "synthetic-reader-password" }
  await createOwnerService(authStorage, createOwnerAuth(authStorage, config)).provision({
    ...credentials,
    name: "Reader",
  })
  const owner = authStorage.provisionedOwner()
  if (!owner) throw new TypeError("Missing owner")
  const storage = openStorage({ databasePath, privateDataRoot: join(directory, "private") })
  const root = join(directory, "private")
  for (const [id, ownerId] of [
    ["import-pending", owner.id],
    ["import-other-owner", "other-owner"],
  ]) {
    if (!id) throw new TypeError("Missing import fixture ID")
    await mkdir(join(root, id), { recursive: true })
    await writeFile(
      join(root, id, "queued.json"),
      JSON.stringify({ id, ownerId, state: "queued", sha256: "c".repeat(64), bytes: 256 }),
    )
  }
  const edition = {
    id: "edition-fixture",
    originalHash: "a".repeat(64),
    originalBlobHash: "a".repeat(64),
    title: "The art of paying attention",
  }
  const normalization = {
    id: "revision-fixture",
    editionId: edition.id,
    editionHash: edition.originalHash,
    parserVersion: "parser-1",
    normalizerVersion: "normalizer-1",
    coverage: "partial",
    resources: [
      {
        path: "chapter-one.xhtml",
        role: "main-chapter",
        status: "included",
        blocks: [
          { id: "opening", text: "Attention begins with a question.", pageLabel: "iv" },
          {
            id: "passage",
            text: "Listen closely. A good question opens a door. Stay curious.",
            originalFragment: "quote",
            pageLabel: "iv",
          },
          {
            id: "unsafe",
            text: '<img src="https://attacker.invalid/probe" onerror="alert(1)"><script>alert(2)</script>',
          },
        ],
      },
      {
        path: "chapter-two.xhtml",
        role: "main-chapter",
        status: "included",
        blocks: [{ id: "second", text: "Reading is a conversation across time." }],
      },
      {
        path: "appendix.xhtml",
        role: "supplementary",
        status: "excluded",
        reason: "unsupported-media",
      },
    ],
  }
  storage.sources.persistDocument({ edition, normalization })
  storage.sources.createStudy({ id: "study-fixture", ownerId: owner.id, editionId: edition.id })
  storage.sources.persistDocument({
    edition,
    normalization: { ...normalization, id: "revision-other" },
  })
  const citation = storage.sources.appendSpan({
    editionId: edition.id,
    normalizationRevisionId: normalization.id,
    resourcePath: "chapter-one.xhtml",
    blockId: "passage",
    start: 16,
    end: 45,
    originalFragment: "quote",
    pageLabel: "iv",
  })
  storage.sources.persistDocument({
    edition: {
      ...edition,
      id: "foreign-edition",
      originalHash: "b".repeat(64),
      originalBlobHash: "b".repeat(64),
    },
    normalization: {
      ...normalization,
      id: "foreign-revision",
      editionId: "foreign-edition",
      editionHash: "b".repeat(64),
    },
  })
  const auth = createServerAuth(authStorage, config)
  const app = createApp({
    ...(options?.studioAssets
      ? { studioAssets: loadStudioAssets(resolve(import.meta.dirname, "../../../studio/dist")) }
      : {}),
    reviewStorage: storage,
    auth: {
      handler: auth.handler,
      ownerId: async (headers) => (await auth.api.getSession({ headers }))?.user.id ?? null,
    },
    sources: storage.sources,
    outlines: storage.outlines,
    workflow: storage.workflow,
    outlineProvider: fixtureOutlineProvider,
    interviews: storage.interviews,
    briefs: storage.briefs,
    providerAvailable: () => options?.providerAvailable ?? true,
    upload: { root },
    security: {
      apiBodyBytes: 1024,
      loginBodyBytes: 4096,
      loginRateLimit: { attempts: 100, windowMs: 60000 },
      trustedOrigins: [origin],
      trustProxy: false,
      uploadBodyBytes: 8192,
      logger: () => undefined,
    },
  })
  server.on("request", getRequestListener(app.fetch))
  return {
    origin,
    databasePath,
    privateDataRoot: root,
    credentials,
    citation,
    storage,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      storage.close()
      authStorage.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}
