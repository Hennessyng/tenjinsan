import { constants } from "node:fs"
import { appendFile, chmod, mkdir, open, readFile, stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { dirname, resolve } from "node:path"
import { z } from "zod"

export const safeLocalEventSchema = z
  .object({
    event: z
      .string()
      .regex(
        /^(auth\.login\.(validation|rejected|exception|success)|access\.(body_limit|content_type|host|origin|rate_limit|resource|session))$/,
      ),
    category: z.string().max(40),
    level: z.enum(["info", "warn", "error"]),
    status: z.number().int().nullable(),
    method: z.string().regex(/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|OTHER)$/),
    requestId: z.uuid(),
    trace_id: z.uuid(),
    route: z.enum([
      "/",
      "/login",
      "/logout",
      "/sources",
      "/interviews",
      "/briefs",
      "/outlines",
      "/evidence",
      "/publications",
      "/revisions",
      "/publication-artifacts",
      "/health",
      "/api/auth",
      "/api/jobs",
      "/api/books",
      "/api/studies",
      "/api/artifacts",
      "/api/imports",
      "/api/backups",
      "/api",
      "/other",
    ]),
    upstream_status: z.number().int().optional(),
  })
  .strict()
  .refine((event) => event.requestId === event.trace_id)
const traceQuerySchema = z.object({ trace_id: z.uuid().optional() })
const allowedEvents = new Set([
  "auth.login.validation",
  "auth.login.rejected",
  "auth.login.exception",
  "auth.login.success",
  "access.body_limit",
  "access.content_type",
  "access.host",
  "access.origin",
  "access.rate_limit",
  "access.resource",
  "access.session",
])
const maximumLogBytes = 2_097_152
const maximumEventBytes = 4096

type SafeEvent = z.infer<typeof safeLocalEventSchema>

export async function readLocalLogEvents(
  path: string,
  traceId?: string,
): Promise<readonly SafeEvent[]> {
  const content = await readFile(path, "utf8")
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => safeLocalEventSchema.parse(JSON.parse(line)))
    .filter((event) => traceId === undefined || event.trace_id === traceId)
}

export type LocalLogCapture = {
  readonly close: () => Promise<void>
  readonly path: string
  readonly url: string
  readonly recordLine: (line: string) => Promise<void> | undefined
}

async function writeResponse(
  response: ServerResponse,
  status: number,
  data: unknown,
): Promise<void> {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  })
  response.end(JSON.stringify(data))
}

export async function startLocalLogCapture(path: string): Promise<LocalLogCapture> {
  const outputPath = resolve(path)
  const directory = dirname(outputPath)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const initialFile = await open(
    outputPath,
    constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await initialFile.chmod(0o600)
  } finally {
    await initialFile.close()
  }
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.headers.host !== undefined && !/^127\.0\.0\.1:\d+$/.test(request.headers.host)) {
      await writeResponse(response, 403, { error: "loopback-host-required" })
      return
    }
    if (
      request.method !== "GET" ||
      (request.url !== "/events" && !request.url?.startsWith("/events?"))
    ) {
      await writeResponse(response, 404, { error: "not-found" })
      return
    }
    const parsed = traceQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url, "http://127.0.0.1").searchParams),
    )
    if (!parsed.success) {
      await writeResponse(response, 400, { error: "invalid-trace-id" })
      return
    }
    try {
      const filtered = await readLocalLogEvents(outputPath, parsed.data.trace_id)
      await writeResponse(response, 200, { events: filtered })
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        await writeResponse(response, 200, { events: [] })
        return
      }
      await writeResponse(response, 500, { error: "log-read-failed" })
    }
  })
  server.listen(0, "127.0.0.1")
  await new Promise<void>((resolveListening, rejectListening) => {
    server.once("listening", resolveListening)
    server.once("error", rejectListening)
  })
  const address = server.address()
  if (!address || typeof address === "string")
    throw new TypeError("Local log API did not bind a TCP port")
  const baseURL = `http://127.0.0.1:${address.port}`
  let writeQueue = Promise.resolve()
  return {
    path: outputPath,
    url: baseURL,
    recordLine: (line) => {
      if (Buffer.byteLength(line) > maximumEventBytes) return
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch (error: unknown) {
        if (error instanceof SyntaxError) return
        throw error
      }
      const parsed = safeLocalEventSchema.safeParse(value)
      if (
        !parsed.success ||
        !allowedEvents.has(parsed.data.event) ||
        parsed.data.requestId !== parsed.data.trace_id
      )
        return
      const serialized = `${JSON.stringify(parsed.data satisfies SafeEvent)}\n`
      const write = writeQueue.then(async () => {
        const current = await stat(outputPath)
        if (current.size + Buffer.byteLength(serialized) <= maximumLogBytes) {
          await appendFile(outputPath, serialized, { mode: 0o600 })
        }
      })
      writeQueue = write.catch(() => undefined)
      return write
    },
    close: async () => {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      )
      await writeQueue
    },
  }
}
