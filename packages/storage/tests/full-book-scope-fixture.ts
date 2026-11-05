import { contentDigest, PINNED_CODEX_BUILD } from "@reading-studio/contracts"
export const approvedBuild = {
  kind: "pinned-codex",
  binaryPath: "/synthetic-reviewed/codex",
  ...PINNED_CODEX_BUILD,
} as const
export const approvedScope = {
  nativeConsentId: "00000000-0000-4000-8000-000000000001",
  budgetConsentId: "00000000-0000-4000-8000-000000000002",
  nativeBinding: contentDigest("synthetic native"),
  budgetBinding: contentDigest("synthetic budget"),
  studyId: "synthetic-study",
  setupId: "synthetic-setup",
  sourceHash: contentDigest("synthetic source"),
  normalizationId: "synthetic-normalization",
  inputBinding: contentDigest("synthetic canonical input"),
  recipientBinding: contentDigest("synthetic recipient"),
  model: "synthetic-model",
  settingsBinding: contentDigest("synthetic settings"),
  fence: 1,
  planBinding: contentDigest("synthetic plan"),
  sourceCeiling: 32,
  hierarchyPolicy: "direct-children-2",
  acknowledgementBinding: contentDigest("synthetic acknowledgement"),
  runtimeBinding: contentDigest("synthetic runtime"),
} as const
