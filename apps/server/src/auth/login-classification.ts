import { clearTimeout, setTimeout } from "node:timers"
import { z } from "zod"
import type { LoginCategory } from "../middleware/security-events.ts"

const authCodeSchema = z.object({ code: z.string().max(128) })
const categories = new Map<string, LoginCategory>([
  ["INVALID_EMAIL_OR_PASSWORD", "invalid-credentials"],
  ["INVALID_PASSWORD", "invalid-credentials"],
  ["INVALID_EMAIL", "validation"],
  ["INVALID_ORIGIN", "origin"],
  ["MISSING_OR_NULL_ORIGIN", "origin"],
  ["CROSS_SITE_NAVIGATION_LOGIN_BLOCKED", "cross-site"],
  ["FAILED_TO_CREATE_SESSION", "session"],
  ["FAILED_TO_GET_SESSION", "session"],
  ["SESSION_EXPIRED", "session"],
  ["SESSION_NOT_FRESH", "session"],
])

async function readCode(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string | undefined> {
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > 4096) return undefined
    text += decoder.decode(chunk.value, { stream: true })
  }
  text += decoder.decode()
  const value: unknown = JSON.parse(text)
  const parsed = authCodeSchema.safeParse(value)
  return parsed.success ? parsed.data.code : undefined
}

export async function classifyLoginRejection(response: Response): Promise<LoginCategory> {
  if (response.status >= 500) return "internal"
  if (response.status === 429) return "rate-limit"
  const fallback = "unknown"
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  // Untrusted upstream diagnostics: malformed, oversized, or stalled bodies use a constant fallback.
  // no-excuse-ok: catch
  try {
    reader = response.clone().body?.getReader()
    if (reader === undefined) return fallback
    const deadline = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), 100)
    })
    const code = await Promise.race([readCode(reader), deadline])
    return code === undefined ? fallback : (categories.get(code) ?? fallback)
  } catch {
    return fallback
  } finally {
    clearTimeout(timer)
    // A tee's cancellation can wait for the original response; do not await it or consume that body.
    if (reader !== undefined) void reader.cancel().catch(() => undefined)
  }
}
