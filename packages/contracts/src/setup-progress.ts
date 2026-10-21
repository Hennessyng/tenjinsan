import { z } from "zod"

export const SetupAnalysisProgress = z.enum([
  "queued",
  "analysis-ready",
  "questions-queued",
  "questions-ready",
  "questions-unknown",
  "questions-attention",
  "bank-incompatible",
  "attention",
  "not-scheduled",
  "unknown",
])
export type SetupAnalysisProgress = z.infer<typeof SetupAnalysisProgress>

export const SetupSchedulingFailure = z.enum([
  "scheduling-interrupted",
  "local-only",
  "provider-unavailable",
  "missing-credentials",
  "unsupported-model",
  "unsupported-settings",
  "unauthorized",
  "input-limit",
  "subscription-unverified",
  "subscription-connection-changed",
  "outcome-unknown",
  "bank-incompatible",
  "analysis-window-limit",
  "empty-text-scope",
  "request-byte-limit",
])
export type SetupSchedulingFailure = z.infer<typeof SetupSchedulingFailure>

export function setupDecisionHeading(
  progress: SetupAnalysisProgress,
  failure: SetupSchedulingFailure | null = null,
): "setup.approved" | "setup.consentSavedTitle" {
  return !failure &&
    (progress === "queued" || progress === "questions-queued" || progress === "questions-ready")
    ? "setup.approved"
    : "setup.consentSavedTitle"
}
export function setupProgressUrl(setupId: string): string {
  return `/jobs?setup=${encodeURIComponent(setupId)}`
}
