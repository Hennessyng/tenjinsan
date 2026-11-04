import { z } from "zod"
import { FullBookConsentReview } from "./full-book-admission.ts"
import { Digest, Timestamp } from "./primitives.ts"

export const PINNED_CODEX_BUILD = {
  version: "0.162.1",
  sourceCommit: "092d3acd6bec3e3a14bdc7e7a2810ab628ab759d",
  sha256: "74c6a6d263f40d65f99c27a815275f5b4ed0bcc2baecc396b4cf3255498bdfc0",
} as const
export const FullBookManagedPolicy = z
  .strictObject({
    version: z.literal("full-book-managed-policy-1"),
    evidence: z.literal("experimental-app-bounded"),
    build: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("pinned-codex"),
        binaryPath: z.string().startsWith("/"),
        sha256: z.literal(PINNED_CODEX_BUILD.sha256),
        version: z.literal(PINNED_CODEX_BUILD.version),
        sourceCommit: z.literal(PINNED_CODEX_BUILD.sourceCommit),
      }),
      z.strictObject({
        kind: z.literal("fixture-not-live-evidence"),
        binaryPath: z.string().startsWith("/"),
        sha256: Digest,
      }),
    ]),
    sampling: z.literal("provider-managed-no-overrides"),
    legacySettingsRole: z.literal("planning-metadata-not-native-sampling"),
    maxFrameBytes: z.number().int().positive().max(128000),
    collectorBytes: z.number().int().positive().max(128000),
    timeoutMs: z.number().int().positive().max(90000),
    warnings: z
      .tuple([
        z.literal("downstream-input-unmeasured"),
        z.literal("collector-not-output-token-enforcement"),
        z.literal("interrupt-or-kill-may-leave-provider-usage-unknown"),
        z.literal("experimental-not-a-route-certificate"),
      ])
      .readonly(),
  })
  .readonly()
export type FullBookManagedPolicy = z.infer<typeof FullBookManagedPolicy>
export const FullBookManagedConsent = z
  .strictObject({
    id: z.uuid(),
    version: z.literal("full-book-managed-consent-1"),
    purpose: z.literal("full-book-managed-experimental"),
    budgetConsentId: z.uuid(),
    budgetBinding: Digest,
    policy: FullBookManagedPolicy,
    warningsAcknowledged: z.literal(true),
    reviewAcknowledgement: FullBookConsentReview.optional(),
    approvedAt: Timestamp,
  })
  .readonly()
export type FullBookManagedConsent = z.infer<typeof FullBookManagedConsent>
export const FULL_BOOK_MANAGED_PROFILE = "tenjinsan-fullbook-deny-files-1"
export function fullBookManagedThread(model: string, cwd: string) {
  return {
    model,
    modelProvider: "openai",
    allowProviderModelFallback: false,
    ephemeral: true,
    cwd,
    runtimeWorkspaceRoots: [],
    environments: [],
    dynamicTools: [],
    selectedCapabilityRoots: [],
    approvalPolicy: "never",
    permissions: FULL_BOOK_MANAGED_PROFILE,
    baseInstructions:
      "Use only supplied structured content. Return JSON. No tools or external sources.",
    developerInstructions: "",
    config: {
      project_doc_max_bytes: 0,
      web_search: "disabled",
      mcp_servers: {},
      permissions: { [FULL_BOOK_MANAGED_PROFILE]: { filesystem: { ":root": "deny" } } },
      "features.shell_tool": false,
      "features.code_mode": false,
      "features.code_mode_host": false,
      "features.multi_agent": false,
      "features.hooks": false,
      "features.plugins": false,
      "features.apps": false,
      "features.memory_tool": false,
      "features.view_image": false,
    },
  }
}
