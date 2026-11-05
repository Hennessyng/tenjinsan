import { readSync } from "node:fs"
import { NULL_PTR, type Ptr } from "@embedpdf/engine-runtime"
import { z } from "zod"
import { DOCUMENT_LIMITS } from "../document-policy.ts"
import { isPdfMemoryFailure } from "./memory.ts"
import { extractPage } from "./page.ts"
import { pageOmission } from "./result.ts"
import { loadPdfRuntime } from "./runtime.ts"

const bounded = (maximum: number) => z.number().int().positive().max(maximum)
const Limits = z.strictObject({
  bytes: bounded(DOCUMENT_LIMITS.pdf.bytes),
  pages: bounded(DOCUMENT_LIMITS.pdf.pages),
  characters: bounded(DOCUMENT_LIMITS.pdf.characters),
  milliseconds: bounded(DOCUMENT_LIMITS.pdf.milliseconds),
  outputBytes: bounded(DOCUMENT_LIMITS.pdf.outputBytes),
})
export type PdfWorkerMetrics = {
  readonly declaredPages: number
  readonly visitedPages: number
  readonly completedPages: number
  readonly omittedPages: number
  readonly probeTargets: number
  readonly probeCopies: number
  readonly probePasses: number
  readonly verifiedTargets: number
  readonly elapsedMilliseconds: number
  readonly outcome: "completed" | "refused" | "failed"
}
export async function runPdfWorker(
  argument: unknown,
  observe?: (metrics: PdfWorkerMetrics) => void,
) {
  const started = performance.now()
  const limits = Limits.parse(argument)
  let declaredPages = 0,
    visitedPages = 0
  let outcome: PdfWorkerMetrics["outcome"] = "failed"
  const pages: string[] = []
  const omissions: ReturnType<typeof pageOmission>[] = []
  const budget = {
    maximumTargetsPerPage: 256,
    documentDeadline: started + Math.min(8000, limits.milliseconds * 0.8),
    pageMilliseconds: 250,
    used: 0,
    copies: 0,
    passes: 0,
    verified: 0,
  }
  const respond = (value: unknown) => {
    const text = JSON.stringify(value)
    const oversized = Buffer.byteLength(text) > limits.outputBytes
    outcome =
      oversized || (typeof value === "object" && value !== null && "error" in value)
        ? "refused"
        : "completed"
    process.stdout.write(oversized ? JSON.stringify({ error: "limit-exceeded" }) : text)
  }
  const buffer = Buffer.alloc(limits.bytes + 1)
  let length = 0
  while (length < buffer.length) {
    const count = readSync(0, buffer, length, buffer.length - length, null)
    if (count === 0) break
    length += count
  }
  if (length > limits.bytes) {
    respond({ error: "limit-exceeded" })
    return
  }
  globalThis.fetch = () => {
    throw new TypeError("external-resources-disabled")
  }
  const runtime = await loadPdfRuntime()
  runtime.fn.EPDF_InitThread()
  const data = runtime.mem.alloc(length)
  let document: Ptr = NULL_PTR
  try {
    if (data === NULL_PTR && length > 0) throw new RangeError("limit-exceeded")
    runtime.mem.writeBytes(data, buffer.subarray(0, length))
    document = runtime.fn.FPDF_LoadMemDocument64(data, length, "")
    if (document === NULL_PTR) {
      respond({
        error: runtime.fn.FPDF_GetLastError() === 4 ? "protected-document" : "invalid-pdf",
      })
      return
    }
    if (runtime.fn.EPDF_IsEncrypted(document)) {
      respond({ error: "protected-document" })
      return
    }
    const count = runtime.fn.FPDF_GetPageCount(document)
    declaredPages = count
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("invalid-page-count")
    if (count > limits.pages) throw new RangeError("limit-exceeded")
    let characters = 0
    for (let index = 0; index < count; index++) {
      visitedPages = index + 1
      const page = runtime.fn.FPDF_LoadPage(document, index)
      if (page === NULL_PTR) {
        pages.push("")
        omissions.push(pageOmission(index + 1, "invalid-page"))
        continue
      }
      try {
        const result = extractPage({
          context: {
            runtime,
            data,
            inputBytes: length,
            pageIndex: index,
            maximumCharacters: limits.characters,
          },
          page,
          budget,
        })
        const failure = "failure" in result ? result.failure : undefined
        const reason = failure ?? (!result.text.trim() ? "no-selectable-text" : undefined)
        const text = reason ? "" : result.text
        characters += text.length
        if (characters > limits.characters) throw new RangeError("limit-exceeded")
        pages.push(text)
        if (reason)
          omissions.push(
            pageOmission(
              index + 1,
              reason,
              result.accounts.flatMap((account) => (account.reason ? [account.reason] : [])),
            ),
          )
      } catch (error) {
        if (error instanceof TypeError) {
          pages.push("")
          omissions.push(pageOmission(index + 1, error.message))
        } else throw error
      } finally {
        runtime.fn.FPDF_ClosePage(page)
      }
    }
    respond({ pages, ...(omissions.length ? { omissions } : {}) })
  } catch (error) {
    if (isPdfMemoryFailure(error)) respond({ error: "limit-exceeded" })
    else if (error instanceof TypeError) respond({ error: "invalid-pdf" })
    else throw error
  } finally {
    if (document !== NULL_PTR) runtime.fn.FPDF_CloseDocument(document)
    runtime.mem.free(data)
    runtime.fn.EPDF_ShutdownThread()
    await runtime.destroy()
    observe?.({
      declaredPages,
      visitedPages,
      completedPages: pages.length,
      omittedPages: omissions.length,
      probeTargets: budget.used,
      probeCopies: budget.copies,
      probePasses: budget.passes,
      verifiedTargets: budget.verified,
      elapsedMilliseconds: performance.now() - started,
      outcome,
    })
  }
}
