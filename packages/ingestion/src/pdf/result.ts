import { z } from "zod"
import { DOCUMENT_LIMITS } from "../document-policy.ts"

export const PdfResult = z.union([
  z.strictObject({ error: z.enum(["limit-exceeded", "protected-document", "invalid-pdf"]) }),
  z
    .strictObject({
      pages: z.array(z.string().max(DOCUMENT_LIMITS.pdf.characters)).max(DOCUMENT_LIMITS.pdf.pages),
      omissions: z
        .array(
          z.strictObject({
            page: z.number().int().positive(),
            reason: z.enum(["no-selectable-text", "unicode-map-error", "unsupported-pdf-text"]),
            details: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u)).max(16),
          }),
        )
        .max(DOCUMENT_LIMITS.pdf.pages)
        .optional(),
    })
    .superRefine((value, context) => {
      if (value.pages.reduce((sum, text) => sum + text.length, 0) > DOCUMENT_LIMITS.pdf.characters)
        context.addIssue({ code: "custom", message: "PDF character bound exceeded" })
      const seen = new Set<number>()
      for (const omission of value.omissions ?? []) {
        if (
          omission.page > value.pages.length ||
          seen.has(omission.page) ||
          value.pages[omission.page - 1]?.trim()
        )
          context.addIssue({ code: "custom", message: "Invalid PDF omission identity" })
        seen.add(omission.page)
      }
    }),
])
export function pageOmission(
  page: number,
  failure: string,
  accountReasons: readonly string[] = [],
) {
  const reason =
    failure === "no-selectable-text" || failure === "unicode-map-error"
      ? failure
      : "unsupported-pdf-text"
  const codes = [failure, ...accountReasons].map((code) =>
    /^[a-z][a-z0-9-]{0,63}$/u.test(code) ? code : "parser-invariant",
  )
  return {
    page,
    reason,
    details: [...new Set(codes.filter((code) => code !== reason))].slice(0, 16),
  }
}
