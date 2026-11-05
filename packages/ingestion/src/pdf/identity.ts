import { NULL_PTR, type PdfRuntimeModule, type Ptr } from "@embedpdf/engine-runtime"
import { nativeLength } from "./native.ts"

export type ObjectIdentity = {
  readonly kind: number
  readonly marks: number
  readonly matrix: readonly number[]
  readonly fontSize: number | null
  readonly active: boolean
}
export function objectIdentity(runtime: PdfRuntimeModule, object: Ptr): ObjectIdentity {
  const matrix = runtime.mem.alloc(24)
  const scalar = runtime.mem.alloc(4)
  try {
    if (matrix === NULL_PTR || scalar === NULL_PTR) throw new RangeError("limit-exceeded")
    const kind = runtime.fn.FPDFPageObj_GetType(object)
    const marks = nativeLength(runtime.fn.FPDFPageObj_CountMarks(object))
    if (marks > 256) throw new RangeError("limit-exceeded")
    if (!runtime.fn.FPDFPageObj_GetMatrix(object, matrix))
      throw new TypeError("source-identity-matrix")
    const values = Array.from({ length: 6 }, (_, index) => {
      const value = runtime.mem.peek(matrix, "f32", index * 4)
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new TypeError("source-identity-matrix")
      return value
    })
    let fontSize: number | null = null
    if (kind === 1) {
      if (!runtime.fn.FPDFTextObj_GetFontSize(object, scalar))
        throw new TypeError("source-identity-font")
      const value = runtime.mem.peek(scalar, "f32")
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new TypeError("source-identity-font")
      fontSize = value
    }
    if (!runtime.fn.FPDFPageObj_GetIsActive(object, scalar))
      throw new TypeError("source-identity-active")
    const active = runtime.mem.peek(scalar, "i32")
    if (active !== 0 && active !== 1) throw new TypeError("source-identity-active")
    return { kind, marks, matrix: values, fontSize, active: active === 1 }
  } finally {
    runtime.mem.free(scalar)
    runtime.mem.free(matrix)
  }
}
