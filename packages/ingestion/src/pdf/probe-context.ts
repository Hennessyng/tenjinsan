import { NULL_PTR, type PdfRuntimeModule, type Ptr } from "@embedpdf/engine-runtime"

export function bracketProbeTarget(input: {
  readonly runtime: PdfRuntimeModule
  readonly page: Ptr
  readonly target: Ptr
  readonly document: Ptr
  readonly insertionIndex: number
}): readonly string[] {
  const { runtime, page, target, document, insertionIndex } = input
  if (runtime.fn.FPDFPage_GetObject(page, insertionIndex) !== target)
    throw new TypeError("probe-context-target-index")
  const matrix = runtime.mem.alloc(24)
  const size = runtime.mem.alloc(4)
  const text = runtime.mem.writeU16String("Q")
  try {
    if (matrix === NULL_PTR || size === NULL_PTR || text === NULL_PTR)
      throw new RangeError("limit-exceeded")
    if (
      !runtime.fn.FPDFPageObj_GetMatrix(target, matrix) ||
      !runtime.fn.FPDFTextObj_GetFontSize(target, size)
    )
      throw new TypeError("probe-context-unavailable")
    const values = Array.from({ length: 6 }, (_, index) =>
      runtime.mem.peek(matrix, "f32", index * 4),
    )
    const fontSize = runtime.mem.peek(size, "f32")
    if (
      typeof fontSize !== "number" ||
      !Number.isFinite(fontSize) ||
      fontSize <= 0 ||
      fontSize > 1024
    )
      throw new TypeError("probe-context-size")
    const a = values[0],
      b = values[1],
      e = values[4],
      f = values[5]
    if (
      typeof a !== "number" ||
      typeof b !== "number" ||
      typeof e !== "number" ||
      typeof f !== "number" ||
      !values.every((value) => typeof value === "number" && Number.isFinite(value))
    )
      throw new TypeError("probe-context-matrix")
    const sentinels: string[] = []
    for (const direction of [-1, 1]) {
      const sentinel = runtime.fn.FPDFPageObj_NewTextObj(document, "Helvetica", fontSize)
      if (sentinel === NULL_PTR) throw new TypeError("probe-sentinel-unavailable")
      let inserted = false
      try {
        if (!runtime.fn.FPDFText_SetText(sentinel, text)) throw new TypeError("probe-sentinel-text")
        runtime.mem.poke(matrix, "f32", e + direction * 2 * fontSize * a, 16)
        runtime.mem.poke(matrix, "f32", f + direction * 2 * fontSize * b, 20)
        if (!runtime.fn.FPDFPageObj_SetMatrix(sentinel, matrix))
          throw new TypeError("probe-sentinel-matrix")
        inserted = runtime.fn.FPDFPage_InsertObjectAtIndex(
          page,
          sentinel,
          insertionIndex + (direction < 0 ? 0 : 2),
        )
        if (!inserted) throw new TypeError("probe-sentinel-insert")
        sentinels.push(String(sentinel))
      } finally {
        if (!inserted) runtime.fn.FPDFPageObj_Destroy(sentinel)
      }
    }
    return sentinels
  } finally {
    runtime.mem.free(text)
    runtime.mem.free(size)
    runtime.mem.free(matrix)
  }
}
