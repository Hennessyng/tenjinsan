import { createHash } from "node:crypto"
import { NULL_PTR, type Ptr } from "@embedpdf/engine-runtime"
import { assemblePage, type Scope } from "./assembly.ts"
import { accountObjects, type LocatedObject, type ProbeBudget } from "./coverage.ts"
import { recoverHyphens } from "./hyphens.ts"
import { type ObjectIdentity, objectIdentity } from "./identity.ts"
import { nativeLength, readCharacters } from "./native.ts"
import type { ProbeContext } from "./probe.ts"
import { decodePdfTextString } from "./text-string.ts"

export function extractPage(input: {
  readonly context: ProbeContext
  readonly page: Ptr
  readonly budget: ProbeBudget
}) {
  const { runtime, maximumCharacters } = input.context
  const { page } = input
  const integer = nativeLength
  const allocate = (bytes: number) => {
    const pointer = runtime.mem.alloc(bytes)
    if (pointer === NULL_PTR && bytes > 0) throw new RangeError("limit-exceeded")
    return pointer
  }
  const properties = new Map<string, Scope | null>()
  let propertyUnits = 0
  const property = (mark: Ptr): Scope | null => {
    const key = String(mark)
    if (properties.has(key)) return properties.get(key) ?? null
    const size = allocate(4)
    let scope: Scope | null = null
    try {
      if (runtime.fn.FPDFPageObjMark_GetParamBlobValue(mark, "ActualText", NULL_PTR, 0, size)) {
        const bytes = integer(runtime.mem.peek(size, "i32"))
        if (bytes > maximumCharacters * 4 + 4) throw new RangeError("limit-exceeded")
        const buffer = allocate(bytes)
        try {
          if (
            !runtime.fn.FPDFPageObjMark_GetParamBlobValue(mark, "ActualText", buffer, bytes, size)
          )
            throw new TypeError("native-property-read")
          const text = decodePdfTextString(runtime.mem.readBytes(buffer, bytes), maximumCharacters)
          propertyUnits += text.length
          if (propertyUnits > maximumCharacters) throw new RangeError("limit-exceeded")
          scope = { id: key, text }
        } finally {
          runtime.mem.free(buffer)
        }
      }
    } finally {
      runtime.mem.free(size)
    }
    properties.set(key, scope)
    return scope
  }
  const objects: LocatedObject[] = []
  const handles = new Map<string, Ptr>()
  let objectCount = 0
  const walk = (object: Ptr, inherited: Scope | null, path: readonly number[]) => {
    if (object === NULL_PTR) throw new TypeError("native-object-missing")
    if (++objectCount > 20000 || path.length > 32) throw new RangeError("limit-exceeded")
    handles.set(path.join("."), object)
    const marks = integer(runtime.fn.FPDFPageObj_CountMarks(object))
    if (marks > 256) throw new RangeError("limit-exceeded")
    let scope = inherited
    for (let index = 0; index < marks; index++) {
      const mark = runtime.fn.FPDFPageObj_GetMark(object, index)
      if (mark === NULL_PTR) throw new TypeError("native-mark-missing")
      const candidate = property(mark)
      scope ??= candidate
    }
    const kind = runtime.fn.FPDFPageObj_GetType(object)
    if (kind === 1) objects.push({ id: String(object), scope, path })
    if (kind === 5) {
      const count = integer(runtime.fn.FPDFFormObj_CountObjects(object))
      if (count > 20000) throw new RangeError("limit-exceeded")
      for (let index = 0; index < count; index++)
        walk(runtime.fn.FPDFFormObj_GetObject(object, index), scope, [...path, index])
    }
  }
  const rootCount = integer(runtime.fn.FPDFPage_CountObjects(page))
  if (rootCount > 20000) throw new RangeError("limit-exceeded")
  for (let index = 0; index < rootCount; index++)
    walk(runtime.fn.FPDFPage_GetObject(page, index), null, [index])
  const characters = readCharacters(runtime, page, maximumCharacters)
  const evidence = {
    characters,
    objects,
    scopes: [...properties.values()].filter((scope) => scope !== null),
  }
  const before = createHash("sha256").update(JSON.stringify(characters)).digest("hex")
  const identities = new Map<string, ObjectIdentity>()
  const sourceIdentity = (path: readonly number[]) => {
    const key = path.join(".")
    const saved = identities.get(key)
    if (saved) return saved
    const handle = handles.get(key)
    if (!handle) throw new TypeError("source-identity-path-missing")
    const identity = objectIdentity(runtime, handle)
    identities.set(key, identity)
    return identity
  }
  const probeStarted = performance.now()
  const { accounts, probeBatch } = accountObjects({
    objects,
    characters,
    context: input.context,
    budget: input.budget,
    sourceIdentity,
  })
  const recovered = recoverHyphens({
    objects,
    characters,
    context: input.context,
    budget: input.budget,
    sourceIdentity,
    deadline: Math.min(input.budget.documentDeadline, probeStarted + input.budget.pageMilliseconds),
  })
  const after = createHash("sha256")
    .update(JSON.stringify(readCharacters(runtime, page, maximumCharacters)))
    .digest("hex")
  if (before !== after) throw new TypeError("original-snapshot-changed")
  const diagnostics = {
    ...evidence,
    accounts,
    probeBatch,
    hyphenRecoveries: recovered.recoveries,
    snapshot: { kind: "characters" as const, before, after, unchanged: true },
  }
  try {
    return {
      ...assemblePage({ objects, characters: recovered.characters, accounts, maximumCharacters }),
      ...diagnostics,
    }
  } catch (error) {
    if (error instanceof TypeError)
      return { text: "", emittedScopes: [], segments: [], failure: error.message, ...diagnostics }
    throw error
  }
}
