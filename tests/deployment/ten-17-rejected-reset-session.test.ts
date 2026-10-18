import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "@reading-studio/server/app"
import { openAuthStorage, openStorage } from "@reading-studio/storage"
import { expect, it } from "vitest"

it("a retained library opens after restart with or without an old session, without a reset", async () => {
  const root = await mkdtemp(join(tmpdir(), "anonymous-restart-"))
  const paths = {
    databasePath: join(root, "studio.sqlite"),
    privateDataRoot: join(root, "private"),
  }
  const legacy = openAuthStorage(paths.databasePath)
  try {
    legacy.sqlite
      .prepare("INSERT INTO auth_users(id,name,email) VALUES(?,?,?)")
      .run("retained-owner", "Synthetic", "synthetic@example.test")
    legacy.sqlite
      .prepare("INSERT INTO auth_sessions(id,expires_at,token,user_id) VALUES(?,?,?,?)")
      .run("retained-session", 1, "synthetic-old-token", "retained-owner")
    const before = legacy.sqlite.prepare("SELECT * FROM auth_sessions").all()
    for (let restart = 0; restart < 2; restart++) {
      const storage = openStorage(paths)
      try {
        const app = createApp({
          reviewStorage: storage,
          sources: storage.sources,
          security: {
            apiBodyBytes: 1024,
            uploadBodyBytes: 1024,
            loginBodyBytes: 1024,
            loginRateLimit: { attempts: 2, windowMs: 60000 },
            trustedOrigins: ["http://localhost"],
            trustProxy: false,
          },
        })
        for (const headers of [{}, { cookie: "better-auth.session_token=synthetic-old-token" }]) {
          const response = await app.request("http://localhost/api/library-context", { headers })
          expect(response.status).toBe(200)
          expect(response.headers.get("set-cookie")).toBeNull()
          expect(await response.json()).toEqual({ studies: [], selectedStudyId: null })
        }
        expect(storage.libraryOwnerId()).toBe("retained-owner")
      } finally {
        storage.close()
      }
    }
    expect(legacy.sqlite.prepare("SELECT * FROM auth_sessions").all()).toEqual(before)
  } finally {
    legacy.close()
    await rm(root, { recursive: true, force: true })
  }
})
