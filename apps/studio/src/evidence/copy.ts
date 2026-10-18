import type { CatalogKey } from "@reading-studio/contracts/i18n"

export const evidenceCategories = {
  support: "evidence.category.support",
  qualification: "evidence.category.qualification",
  translation: "evidence.category.translation",
  visual: "evidence.category.visual",
} as const

export const evidenceStatuses: Readonly<Record<string, CatalogKey>> = {
  unresolved: "evidence.status.unresolved",
  reviewed: "evidence.status.reviewed",
  acknowledged: "evidence.status.acknowledged",
  pending: "evidence.status.pending",
  passed: "evidence.status.passed",
  blocked: "evidence.status.blocked",
}

export function evidenceStatus(status: string, t: (key: CatalogKey) => string): string {
  const key = evidenceStatuses[status]
  return key === undefined ? status : t(key)
}
