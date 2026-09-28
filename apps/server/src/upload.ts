import { ArchiveError, acceptUpload, type UploadOptions } from "@reading-studio/ingestion/archive"
import type { Hono } from "hono"
import type { AppEnvironment } from "./middleware/access.ts"

export type UploadWithHook = Omit<UploadOptions, "ownerId"> & {
  readonly onAccepted?: (
    receipt: Awaited<ReturnType<typeof acceptUpload>>,
    ownerId: string,
  ) => Promise<void>
}

export function configureUpload(app: Hono<AppEnvironment>, options: UploadWithHook) {
  app.post("/api/imports/upload", async (context) => {
    if (
      context.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/epub+zip"
    ) {
      return context.json({ error: "unsupported-media-type" }, 415)
    }
    const body = context.req.raw.body
    if (body === null) return context.json({ error: "invalid-archive" }, 422)
    try {
      const receipt = await acceptUpload(body, { ...options, ownerId: context.get("ownerId") })
      await options.onAccepted?.(receipt, context.get("ownerId"))
      return context.json(receipt, 202)
    } catch (error) {
      if (error instanceof ArchiveError) {
        return context.json({ error: error.code }, error.code === "limit-exceeded" ? 413 : 422)
      }
      throw error
    }
  })
}
