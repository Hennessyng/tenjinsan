import {
  contentDigest,
  type EvidenceDraft,
  PrivacyReview,
  projectedStrings,
} from "@reading-studio/contracts"

function normalized(text: string): string {
  const decoded = text
    .replace(/\\u([\da-f]{4})/giu, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/&#x([\da-f]+);/giu, (_, hex: string) =>
      String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff)),
    )
    .replace(/&#(\d+);/gu, (_, digits: string) =>
      String.fromCodePoint(Math.min(Number(digits), 0x10ffff)),
    )
    .replace(/%([\da-f]{2})/giu, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
  return decoded
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{Cf}]/gu, "")
}

export function reviewPrivacy(draft: EvidenceDraft) {
  const strings = projectedStrings(draft.projection)
  const canaries = draft.privateDetails.map(normalized)
  const findings = strings.flatMap(({ path, text }) => {
    const value = normalized(text)
    const known = canaries.some((detail) => detail.length > 0 && value.includes(detail))
    const manual = draft.manualFlags.some(
      (flag) => flag.path === path && flag.textHash === contentDigest(text),
    )
    const contact = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?<![a-z\d])\+?\d[\d().-]{7,}\d(?![a-z\d])/iu.test(
      value,
    )
    const secret =
      /(?:sk-[a-z\d_-]{12,}|(?:password|api[_-]?key|パスワード|秘密鍵)[:=：]\S+)/iu.test(value)
    return known || manual || contact || secret
      ? [
          {
            path,
            category: secret ? ("secret" as const) : ("personal-detail" as const),
            resolution: "unresolved" as const,
          },
        ]
      : []
  })
  return PrivacyReview.parse({
    id: `privacy-${contentDigest(JSON.stringify({ id: draft.id, findings }))}`,
    projectionHash: draft.projectionHash,
    reviewedPaths: strings.map((entry) => entry.path),
    findings,
    status: findings.length === 0 && draft.privacyReviewed ? "passed" : "blocked",
  })
}
