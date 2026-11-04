import { z } from "zod"
export const ServerErrorCode = z.enum([
  "contextWindowExceeded",
  "sessionBudgetExceeded",
  "usageLimitExceeded",
  "rateLimitExceeded",
  "flexUnavailable",
  "serverOverloaded",
  "cyberPolicy",
  "misalignmentPolicyViolation",
  "tooManyDenials",
  "internalServerError",
  "unauthorized",
  "badRequest",
  "threadRollbackFailed",
  "sandboxError",
  "httpConnectionFailed",
  "responseStreamConnectionFailed",
  "responseStreamDisconnected",
  "responseTooManyFailedAttempts",
  "activeTurnNotSteerable",
  "other",
])
export function safeServerError(raw: unknown) {
  const text = ServerErrorCode.safeParse(raw)
  if (text.success) return { code: text.data }
  const record = z.record(z.string(), z.unknown()).safeParse(raw)
  for (const key of [
    "httpConnectionFailed",
    "responseStreamConnectionFailed",
    "responseStreamDisconnected",
    "responseTooManyFailedAttempts",
    "activeTurnNotSteerable",
  ] as const) {
    if (!record.success || !(key in record.data)) continue
    const status = z
      .object({ httpStatusCode: z.number().int().min(0).max(65535).nullish() })
      .safeParse(record.data[key])
    return {
      code: key,
      ...(status.success && status.data.httpStatusCode != null
        ? { httpStatus: status.data.httpStatusCode }
        : {}),
    }
  }
  return { code: "other" as const }
}
