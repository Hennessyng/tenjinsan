import { FullBookTestError } from "@reading-studio/contracts"
import type { Storage } from "@reading-studio/storage"
import type { Hono } from "hono"
import { z } from "zod"
import { FullBookPreparationError, FullBookPreparationOptions } from "./full-book-preparation.ts"
import { reviewFullBook } from "./full-book-review.ts"
import { configureFullBookRuns } from "./full-book-runs-api.ts"
import type { FullBookServerRuntime } from "./full-book-runtime.ts"
import type { AppEnvironment } from "./middleware/access.ts"
import { hasForwardedHeaders } from "./subscriptions.ts"

export function configureFullBookPreparation(
  app: Hono<AppEnvironment>,
  storage: Storage,
  options: Readonly<{ local: boolean; runtime: FullBookServerRuntime | undefined }>,
) {
  const { local, runtime } = options
  app.use("/api/full-book-test/*", async (context, next) => {
    context.header("Cache-Control", "private, no-store")
    if (
      !local ||
      (!context.req.header("origin") && context.req.method !== "GET") ||
      hasForwardedHeaders(context.req.raw.headers)
    )
      return context.json({ error: "local-owner-origin-required", transmission: "not-sent" }, 403)
    return next()
  })
  for (const action of ["prepare", "review"] as const)
    app.post(`/api/full-book-test/:setup/${action}`, async (context) => {
      let raw: unknown
      try {
        raw = await context.req.json()
      } catch (error) {
        if (error instanceof SyntaxError)
          return context.json(
            { error: "invalid-experimental-options", transmission: "not-sent" },
            400,
          )
        throw error
      }
      const parsed = (
        action === "prepare"
          ? FullBookPreparationOptions
          : z.strictObject({ options: FullBookPreparationOptions, reviewBinding: z.string() })
      ).safeParse(raw)
      if (!parsed.success)
        return context.json(
          { error: "invalid-experimental-options", transmission: "not-sent" },
          400,
        )
      try {
        const data = parsed.data,
          options = "options" in data ? data.options : data
        const prepared = reviewFullBook(
          { storage, runtime },
          { owner: context.get("ownerId"), setupId: context.req.param("setup") },
          options,
        )
        if ("reviewBinding" in data && data.reviewBinding !== prepared.reviewBinding)
          throw new FullBookPreparationError("review-stale")
        return context.json({
          ...prepared.summary,
          reviewBinding: prepared.reviewBinding,
          transmission: "not-sent",
        })
      } catch (error) {
        if (error instanceof FullBookPreparationError || error instanceof FullBookTestError)
          return context.json({ error: error.reason, transmission: "not-sent" }, 409)
        throw error
      }
    })
  configureFullBookRuns(app, storage, runtime)
  for (const action of ["send"] as const)
    app.post(`/api/full-book-test/:setup/${action}`, (context) =>
      context.json(
        {
          error: "release-and-runtime-binding-required",
          native: { enabled: false },
          transmission: "not-sent",
        },
        409,
      ),
    )
}
