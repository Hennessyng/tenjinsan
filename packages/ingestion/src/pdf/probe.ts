import { NULL_PTR, type PdfRuntimeModule, type Ptr } from "@embedpdf/engine-runtime"
import type { Character } from "./assembly.ts"
import type { LocatedObject } from "./coverage.ts"
import { type ObjectIdentity, objectIdentity } from "./identity.ts"
import { nativeLength, readCharacters } from "./native.ts"
import { bracketProbeTarget } from "./probe-context.ts"

export type ProbeContext = {
  readonly runtime: PdfRuntimeModule
  readonly data: Ptr
  readonly inputBytes: number
  readonly pageIndex: number
  readonly maximumCharacters: number
}
export type ProbeStats = { used: number; copies: number; passes: number; verified: number }
export type ProbeTarget = LocatedObject & { readonly lineage: readonly ObjectIdentity[] }
export type ProbeObservation = {
  readonly path: readonly number[]
  readonly sourceObject: string
  readonly target: string
  readonly characters: readonly Character[]
  readonly initialCharacters: readonly Character[]
  readonly sentinels: readonly string[]
  readonly text: string
  readonly wellFormed: boolean
  readonly copyOnly: true
  readonly batch: true
  readonly identityVerified: true
  readonly sourceLineage: readonly ObjectIdentity[]
}
export function probeObjects(
  context: ProbeContext,
  targets: readonly ProbeTarget[],
  run: { readonly deadline: number; readonly stats: ProbeStats },
): ReadonlyMap<string, ProbeObservation> {
  const { runtime } = context
  const checkTime = () => {
    if (performance.now() >= run.deadline) throw new RangeError("probe-time-limit")
  }
  checkTime()
  const document = runtime.fn.FPDF_LoadMemDocument64(context.data, context.inputBytes, "")
  if (document === NULL_PTR) throw new TypeError("probe-document-unavailable")
  run.stats.copies++
  let page: Ptr = NULL_PTR
  try {
    checkTime()
    page = runtime.fn.FPDF_LoadPage(document, context.pageIndex)
    if (page === NULL_PTR) throw new TypeError("probe-page-unavailable")
    const expected = new Map<string, ObjectIdentity>()
    const leaves = new Map(targets.map((target) => [target.path.join("."), target]))
    for (const target of targets)
      for (let depth = 0; depth < target.path.length; depth++) {
        const identity = target.lineage[depth]
        if (!identity) throw new TypeError("source-identity-missing")
        const key = target.path.slice(0, depth + 1).join(".")
        const prior = expected.get(key)
        if (prior && JSON.stringify(prior) !== JSON.stringify(identity))
          throw new TypeError("source-identity-conflict")
        expected.set(key, identity)
      }
    const copies = new Map<string, Ptr>()
    const prune = (form: Ptr | null, prefix: readonly number[]) => {
      checkTime()
      const count = nativeLength(
        form === null
          ? runtime.fn.FPDFPage_CountObjects(page)
          : runtime.fn.FPDFFormObj_CountObjects(form),
      )
      if (count > 20000) throw new RangeError("limit-exceeded")
      const siblings = Array.from({ length: count }, (_, index) =>
        form === null
          ? runtime.fn.FPDFPage_GetObject(page, index)
          : runtime.fn.FPDFFormObj_GetObject(form, index),
      )
      for (const [index, object] of siblings.entries()) {
        checkTime()
        const path = [...prefix, index]
        const key = path.join(".")
        const identity = expected.get(key)
        if (!identity) {
          const removed =
            form === null
              ? runtime.fn.FPDFPage_RemoveObject(page, object)
              : runtime.fn.FPDFFormObj_RemoveObject(form, object)
          if (!removed) throw new TypeError("probe-isolation-failed")
          runtime.fn.FPDFPageObj_Destroy(object)
          continue
        }
        if (JSON.stringify(objectIdentity(runtime, object)) !== JSON.stringify(identity))
          throw new TypeError("probe-source-identity-mismatch")
        const leaf = leaves.get(key)
        if (leaf) {
          if (identity.kind !== 1 || copies.has(leaf.id))
            throw new TypeError("probe-target-not-unique-text")
          copies.set(leaf.id, object)
          run.stats.verified++
        } else {
          if (identity.kind !== 5) throw new TypeError("probe-form-path-mismatch")
          prune(object, path)
        }
      }
    }
    prune(null, [])
    if (copies.size !== targets.length || new Set(copies.values()).size !== targets.length)
      throw new TypeError("probe-target-missing")
    const read = () => {
      checkTime()
      run.stats.passes++
      const result = readCharacters(runtime, page, context.maximumCharacters)
      checkTime()
      return result
    }
    const initial = read()
    const group = (characters: readonly Character[]) => {
      const result = new Map<string, Character[]>()
      for (const character of characters)
        if (character.object !== null) {
          const rows = result.get(character.object) ?? []
          rows.push(character)
          result.set(character.object, rows)
        }
      return result
    }
    const first = group(initial)
    const sentinels = new Map<string, readonly string[]>()
    const rootPositions = new Map(
      Array.from(
        { length: nativeLength(runtime.fn.FPDFPage_CountObjects(page)) },
        (_, index) => [runtime.fn.FPDFPage_GetObject(page, index), index] as const,
      ),
    )
    const brackets = targets
      .filter((target) => target.path.length === 1)
      .map((target) => {
        const pointer = copies.get(target.id)
        const position = pointer === undefined ? undefined : rootPositions.get(pointer)
        if (pointer === undefined || position === undefined)
          throw new TypeError("probe-context-target-index")
        return { target, pointer, position }
      })
      .sort((left, right) => right.position - left.position)
    for (const { target, pointer, position } of brackets) {
      checkTime()
      if (!first.get(String(pointer))?.length)
        sentinels.set(
          target.id,
          bracketProbeTarget({
            runtime,
            page,
            target: pointer,
            document,
            insertionIndex: position,
          }),
        )
    }
    const last = sentinels.size ? group(read()) : first
    const observations = new Map<string, ProbeObservation>()
    for (const target of targets) {
      checkTime()
      const pointer = copies.get(target.id)
      if (!pointer) throw new TypeError("probe-target-missing")
      const characters = last.get(String(pointer)) ?? []
      const text = characters.map((character) => String.fromCodePoint(character.codepoint)).join("")
      observations.set(target.id, {
        path: target.path,
        sourceObject: target.id,
        target: String(pointer),
        characters,
        initialCharacters: first.get(String(pointer)) ?? [],
        sentinels: sentinels.get(target.id) ?? [],
        text,
        wellFormed: text.isWellFormed(),
        copyOnly: true,
        batch: true,
        identityVerified: true,
        sourceLineage: target.lineage,
      })
    }
    run.stats.used += observations.size
    return observations
  } finally {
    if (page !== NULL_PTR) runtime.fn.FPDF_ClosePage(page)
    runtime.fn.FPDF_CloseDocument(document)
  }
}
