import { LOCAL_CHATGPT_INFERENCE_POLICY } from "@reading-studio/contracts/subscriptions"
export const syntheticDiscoveryNormalization = {
  id: "normalization-1",
  editionId: "edition-1",
  editionHash: "a".repeat(64),
  parserVersion: "1",
  normalizerVersion: "1",
  coverage: "complete",
  resources: [
    {
      path: "book.txt",
      role: "main-chapter",
      status: "included",
      blocks: [{ id: "block-1", text: "Synthetic local input" }],
    },
  ],
} as const

export const syntheticCurrentAnalysis = {
  provider: "chatgpt-subscription",
  processing: { inferencePolicyVersion: LOCAL_CHATGPT_INFERENCE_POLICY },
} as const
export const syntheticPreparedLocalReview = {
  available: true,
  deployment: "local",
  preparation: {
    state: "ready",
    reason: null,
    groupCount: 1,
    partCount: 1,
    allowance: {
      cap: 64,
      used: 0,
      remaining: 64,
      plannedAttempts: 20,
      reservedLaterAttempts: 12,
      uncertainCounts: true,
    },
  },
} as const
export function syntheticCatalog(model = "synthetic", label = "Synthetic model") {
  return {
    deployment: "local",
    connections: [
      {
        provider: "chatgpt-subscription",
        route: "codex-app-server",
        status: "connected",
        connectionRevision: 1,
        canConnect: false,
        canDispatch: true,
        catalog: "checked",
        models: [{ model, label }],
        account: null,
        blockers: [],
      },
    ],
  }
}
