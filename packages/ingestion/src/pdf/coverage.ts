import type { Character, ObjectAccount, TextObject } from "./assembly.ts"
import type { ObjectIdentity } from "./identity.ts"
import { type ProbeContext, type ProbeObservation, type ProbeStats, probeObjects } from "./probe.ts"

export type LocatedObject = TextObject & { readonly path: readonly number[] }
export type ProbeBudget = ProbeStats & {
  readonly maximumTargetsPerPage: number
  readonly documentDeadline: number
  readonly pageMilliseconds: number
}
export function accountObjects(input: {
  readonly objects: readonly LocatedObject[]
  readonly characters: readonly Character[]
  readonly context: ProbeContext
  readonly budget: ProbeBudget
  readonly sourceIdentity: (path: readonly number[]) => ObjectIdentity
}) {
  const represented = new Set(
    input.characters
      .filter((character) => !character.generated)
      .map((character) => character.object),
  )
  const anchors = new Map<string, string>()
  for (const object of input.objects)
    if (object.scope && represented.has(object.id) && !anchors.has(object.scope.id))
      anchors.set(object.scope.id, object.id)
  const pending = input.objects.filter(
    (object) => !represented.has(object.id) && !(object.scope && anchors.has(object.scope.id)),
  )
  const start = performance.now()
  const before = { ...input.budget }
  const deadline = Math.min(input.budget.documentDeadline, start + input.budget.pageMilliseconds)
  let probes: ReadonlyMap<string, ProbeObservation> = new Map()
  let failure: string | undefined
  if (pending.length > input.budget.maximumTargetsPerPage) failure = "probe-limit"
  else if (pending.length) {
    try {
      if (performance.now() >= deadline) throw new RangeError("probe-time-limit")
      const targets = pending.map((object) => {
        if (performance.now() >= deadline) throw new RangeError("probe-time-limit")
        return {
          ...object,
          lineage: object.path.map((_, index) =>
            input.sourceIdentity(object.path.slice(0, index + 1)),
          ),
        }
      })
      probes = probeObjects(input.context, targets, { deadline, stats: input.budget })
    } catch (error) {
      if (error instanceof TypeError) failure = error.message
      else throw error
    }
  }
  const accounts = input.objects.map((object): ObjectAccount => {
    if (represented.has(object.id)) return { id: object.id, kind: "represented" }
    const anchor = object.scope === null ? undefined : anchors.get(object.scope.id)
    if (anchor) return { id: object.id, kind: "scope-covered", anchor }
    const probe = probes.get(object.id)
    if (failure || !probe)
      return { id: object.id, kind: "unexplained", reason: failure ?? "probe-target-missing" }
    if (probe.characters.some((character) => character.mappingError))
      return { id: object.id, kind: "unexplained", reason: "probe-unicode-map-error", probe }
    if (object.scope?.text === "" && probe.wellFormed)
      return { id: object.id, kind: "empty-replacement", probe }
    if (object.scope === null && probe.wellFormed && /^ +$/u.test(probe.text))
      return { id: object.id, kind: "whitespace", probe }
    return { id: object.id, kind: "unexplained", reason: "batched-object-not-whitespace", probe }
  })
  return {
    accounts,
    probeBatch: {
      requested: pending.length,
      copies: input.budget.copies - before.copies,
      passes: input.budget.passes - before.passes,
      verified: input.budget.verified - before.verified,
      completed: input.budget.used - before.used,
      elapsedMilliseconds: performance.now() - start,
      ...(failure ? { failure } : {}),
    },
  }
}
