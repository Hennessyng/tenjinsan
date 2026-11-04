import { FullBookConsentError, FullBookTestError } from "@reading-studio/contracts"
import { FullBookExecutionError, type Storage } from "@reading-studio/storage"
import type { Hono } from "hono"
import { z } from "zod"
import { admitFullBook } from "./full-book-admission.ts"
import { FullBookLifecycle } from "./full-book-lifecycle.ts"
import { FullBookPreparationError } from "./full-book-preparation.ts"
import type { FullBookServerRuntime } from "./full-book-runtime.ts"
import type { AppEnvironment } from "./middleware/access.ts"

export function configureFullBookRuns(
  app: Hono<AppEnvironment>,
  storage: Storage,
  runtime: FullBookServerRuntime | undefined,
) {
  const lifecycle = new FullBookLifecycle(storage, runtime)
  app.post("/api/full-book-test/:setup/consent", async (context) => {
    try {
      const state = admitFullBook(
        { storage, runtime },
        { owner: context.get("ownerId"), setupId: context.req.param("setup") },
        await context.req.json(),
      )
      return context.json(
        lifecycle.state({
          id: state.id,
          owner: context.get("ownerId"),
          setupId: context.req.param("setup"),
        }),
        201,
      )
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return context.json({ error: "invalid-exact-consent", transmission: "not-sent" }, 400)
      if (
        error instanceof FullBookConsentError ||
        error instanceof FullBookPreparationError ||
        error instanceof FullBookTestError
      )
        return context.json({ error: error.reason, transmission: "not-sent" }, 409)
      throw error
    }
  })
  app.get("/api/full-book-test/:setup/runs", (context) =>
    context.json({ runs: lifecycle.history(context.get("ownerId"), context.req.param("setup")) }),
  )
  app.get("/api/full-book-test/:setup/runs/:run", (context) => {
    try {
      return context.json(
        lifecycle.state({
          id: context.req.param("run"),
          owner: context.get("ownerId"),
          setupId: context.req.param("setup"),
        }),
      )
    } catch (error) {
      if (error instanceof FullBookConsentError)
        return context.json({ error: "run-unavailable" }, 404)
      throw error
    }
  })
  app.get("/api/full-book-test/:setup/runs/:run/export", (context) => {
    try {
      const bytes = storage.fullBookManagedConsents.exportHistory({
        id: context.req.param("run"),
        owner: context.get("ownerId"),
        setupId: context.req.param("setup"),
      })
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="full-book-history-${context.req.param("run")}.json"`,
          "Cache-Control": "private, no-store",
        },
      })
    } catch (error) {
      if (error instanceof FullBookConsentError)
        return context.json({ error: "closed-historical-export-required" }, 409)
      throw error
    }
  })
  for (const action of ["resume", "cancel", "decision"] as const)
    app.post(`/api/full-book-test/:setup/runs/:run/${action}`, async (context) => {
      const scope = {
        id: context.req.param("run"),
        owner: context.get("ownerId"),
        setupId: context.req.param("setup"),
      }
      try {
        const raw: unknown = await context.req.json()
        if (action === "decision") {
          const input = z
            .strictObject({
              attemptId: z.string().min(1),
              decision: z.enum(["retry", "stop"]),
              acknowledgeUnknownCharge: z.literal(true),
            })
            .parse(raw)
          return context.json(lifecycle.decide(scope, input.attemptId, input.decision))
        }
        z.strictObject({}).parse(raw)
        return context.json(
          action === "cancel" ? lifecycle.cancel(scope) : await lifecycle.resume(scope),
        )
      } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError)
          return context.json({ error: "invalid-run-command" }, 400)
        if (error instanceof FullBookConsentError || error instanceof FullBookExecutionError)
          return context.json({ error: error.reason, transmission: "check-saved-run" }, 409)
        throw error
      }
    })
}
