import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Context, Hono } from "hono"
import type { AppEnvironment } from "./middleware/access.ts"

type Asset = { readonly body: string; readonly contentType: string }
export type StudioAssets = {
  readonly index: string
  readonly files: ReadonlyMap<string, Asset>
}

const studioPath =
  /^\/(?:jobs|imports|sources(?:\/[^/]+(?:\/setup(?:\/[^/]+)?)?)?|interviews(?:\/[^/]+)?|briefs\/[^/]+|outlines\/[^/]+|evidence\/[^/]+(?:\/[^/]+)?|publications\/[^/]+|revisions\/[^/]+)$/u
const legacyOutputPath = /^\/publications\/[^/]+\/outputs\/[^/]+$/u

export function loadStudioAssets(directory: string): StudioAssets {
  const index = readFileSync(join(directory, "index.html"), "utf8")
  const files = new Map<string, Asset>()
  for (const name of readdirSync(join(directory, "assets"))) {
    const contentType = name.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : name.endsWith(".css")
        ? "text/css; charset=utf-8"
        : null
    if (contentType)
      files.set(name, { body: readFileSync(join(directory, "assets", name), "utf8"), contentType })
  }
  files.set("favicon.svg", {
    body: readFileSync(join(directory, "favicon.svg"), "utf8"),
    contentType: "image/svg+xml",
  })
  return { index, files }
}

export function configureStudioAssets(
  app: Hono<AppEnvironment>,
  assets: StudioAssets,
  ownerId: (headers: Headers) => Promise<string | null>,
): void {
  app.get("/assets/:asset", (context) => {
    const file = assets.files.get(context.req.param("asset"))
    if (!file) return context.notFound()
    context.header("Cache-Control", "public, max-age=31536000, immutable")
    context.header("X-Content-Type-Options", "nosniff")
    return context.body(file.body, 200, { "Content-Type": file.contentType })
  })
  app.get("/favicon.svg", (context) => {
    const file = assets.files.get("favicon.svg")
    if (!file) return context.notFound()
    context.header("X-Content-Type-Options", "nosniff")
    return context.body(file.body, 200, { "Content-Type": file.contentType })
  })
  app.use("*", async (context, next) => {
    if (
      context.req.method === "POST" &&
      (studioPath.test(context.req.path) || legacyOutputPath.test(context.req.path))
    )
      return context.text("Use the authenticated JSON API", 405)
    if (context.req.method !== "GET" || !studioPath.test(context.req.path)) return next()
    if ((await ownerId(context.req.raw.headers)) === null) return context.text("Unauthorized", 401)
    return studioResponse(context, assets)
  })
}

export function studioResponse(context: Context<AppEnvironment>, assets: StudioAssets) {
  context.header("Cache-Control", "private, no-store")
  context.header("X-Content-Type-Options", "nosniff")
  context.header("Referrer-Policy", "no-referrer")
  context.header(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  )
  return context.html(assets.index)
}
