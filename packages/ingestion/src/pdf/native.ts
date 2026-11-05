import { NULL_PTR, type PdfRuntimeModule, type Ptr } from "@embedpdf/engine-runtime"
import type { Character } from "./assembly.ts"

export function nativeLength(value: number | bigint): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError("invalid-native-length")
  return value
}

export function readCharacters(
  runtime: PdfRuntimeModule,
  page: Ptr,
  maximumCharacters: number,
): readonly Character[] {
  const textPage = runtime.fn.FPDFText_LoadPage(page)
  if (textPage === NULL_PTR) throw new TypeError("native-text-page-missing")
  try {
    const count = nativeLength(runtime.fn.FPDFText_CountChars(textPage))
    if (count > maximumCharacters) throw new RangeError("limit-exceeded")
    return Array.from({ length: count }, (_, index) => {
      const generated = runtime.fn.FPDFText_IsGenerated(textPage, index)
      const error = runtime.fn.FPDFText_HasUnicodeMapError(textPage, index)
      const hyphen = runtime.fn.FPDFText_IsHyphen(textPage, index)
      if (
        (generated !== 0 && generated !== 1) ||
        (error !== 0 && error !== 1) ||
        (hyphen !== 0 && hyphen !== 1)
      )
        throw new TypeError("native-character-flags")
      const object = runtime.fn.FPDFText_GetTextObject(textPage, index)
      return {
        codepoint: runtime.fn.FPDFText_GetUnicode(textPage, index),
        generated: generated === 1,
        mappingError: error === 1,
        hyphen: hyphen === 1,
        object: object === NULL_PTR ? null : String(object),
      }
    })
  } finally {
    runtime.fn.FPDFText_ClosePage(textPage)
  }
}
