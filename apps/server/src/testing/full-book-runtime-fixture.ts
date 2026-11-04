import { contentDigest, FullBookManagedPolicy } from "@reading-studio/contracts"
import type { FullBookPreparationOptions } from "../full-book-preparation.ts"

export function fixtureRuntimePolicy(
  binaryPath: string,
  bytes: string,
  input: FullBookPreparationOptions,
) {
  return FullBookManagedPolicy.parse({
    version: "full-book-managed-policy-1",
    evidence: "experimental-app-bounded",
    build: { kind: "fixture-not-live-evidence", binaryPath, sha256: contentDigest(bytes) },
    sampling: "provider-managed-no-overrides",
    legacySettingsRole: "planning-metadata-not-native-sampling",
    maxFrameBytes: input.policy.maxAppBytes,
    collectorBytes: input.collectorBytes,
    timeoutMs: input.timeoutMs,
    warnings: [
      "downstream-input-unmeasured",
      "collector-not-output-token-enforcement",
      "interrupt-or-kill-may-leave-provider-usage-unknown",
      "experimental-not-a-route-certificate",
    ],
  })
}
