import { Hono, type MiddlewareHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import type { AppEnvironment, createAccessMiddleware } from "../middleware/access.ts"
import { classifyLoginRejection } from "./login-classification.ts"
import {
  adaptAuthRequest,
  loginPage,
  loginRejectionPage,
  redirectWithCookies,
} from "./login-page.ts"

const loginSchema = z.object({ email: z.email(), password: z.string().min(1) })

export function configureLoginRoute(
  app: Hono<AppEnvironment>,
  access: ReturnType<typeof createAccessMiddleware>,
  handler: (request: Request) => Promise<Response>,
): void {
  // Scoped error handling preserves Hono's HTTP errors without its raw console.error fallback.
  const login = new Hono<AppEnvironment>()
  login.onError((error, context) => {
    const response =
      error instanceof HTTPException
        ? error.getResponse()
        : new Response("Internal Server Error", { status: 500 })
    access.record(context, {
      event: "auth.login.exception",
      category: "internal",
      level: response.status >= 500 ? "error" : "warn",
      status: response.status,
    })
    return context.newResponse(response.body, response)
  })
  const traceThrows: MiddlewareHandler<AppEnvironment> = async (context, next) => {
    try {
      await next()
    } catch (error) {
      // Hono handles Error instances above; preserve propagation for non-Error thrown values.
      access.record(context, {
        event: "auth.login.exception",
        category: "internal",
        level: "error",
        status: null,
      })
      throw error
    }
  }
  login.use("/login", traceThrows)
  login.use("/api/auth/sign-in/email", traceThrows)
  login.post("/login", access.loginRateLimit, access.loginBodyLimit, async (context) => {
    if (context.req.header("origin") === undefined) {
      access.record(context, {
        event: "auth.login.validation",
        category: "origin",
        level: "warn",
        status: 403,
      })
      return context.html(loginRejectionPage(context.get("requestId")), 403)
    }
    const parsed = loginSchema.safeParse(await context.req.parseBody())
    if (!parsed.success) {
      access.record(context, {
        event: "auth.login.validation",
        category: "validation",
        level: "warn",
        status: 401,
      })
      return context.html(loginPage(true, "login", context.get("requestId")), 401)
    }
    const request = adaptAuthRequest(
      context.req.raw,
      "/api/auth/sign-in/email",
      JSON.stringify(parsed.data),
    )
    const response = await handler(request)
    if (!response.ok) {
      const category = await classifyLoginRejection(response)
      // The form maps this response to generic HTML; release the discarded original tee branch.
      // Cancellation may wait on the source and must never delay or replace the public response.
      if (response.body !== null) void response.body.cancel().catch(() => undefined)
      access.record(context, {
        event: "auth.login.rejected",
        category,
        level: response.status >= 500 ? "error" : "warn",
        upstream_status: response.status,
        status: 401,
      })
      return context.html(loginPage(true, "login", context.get("requestId")), 401)
    }
    const redirect = redirectWithCookies(response, "/")
    redirect.headers.append(
      "Set-Cookie",
      `tj_entry=1; Path=/; Max-Age=30; SameSite=Strict${new URL(context.req.url).protocol === "https:" ? "; Secure" : ""}`,
    )
    access.record(context, {
      event: "auth.login.success",
      category: "success",
      level: "info",
      upstream_status: response.status,
      status: 303,
    })
    return redirect
  })
  login.on(
    ["GET", "POST"],
    "/api/auth/sign-in/email",
    access.loginRateLimit,
    access.loginBodyLimit,
    async (context) => {
      const response = await handler(context.req.raw)
      access.record(context, {
        event: response.ok ? "auth.login.success" : "auth.login.rejected",
        category: response.ok ? "success" : await classifyLoginRejection(response),
        level: response.ok ? "info" : response.status >= 500 ? "error" : "warn",
        upstream_status: response.status,
        status: response.status,
      })
      return response
    },
  )
  app.route("/", login)
}
