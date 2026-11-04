import type { Character } from "./assembly.ts"
import type { LocatedObject, ProbeBudget } from "./coverage.ts"
import type { ObjectIdentity } from "./identity.ts"
import { type ProbeContext, probeObjects } from "./probe.ts"

export function recoverHyphens(input: {
  readonly objects: readonly LocatedObject[]
  readonly characters: readonly Character[]
  readonly context: ProbeContext
  readonly budget: ProbeBudget
  readonly deadline: number
  readonly sourceIdentity: (path: readonly number[]) => ObjectIdentity
}) {
  const objects = new Map(input.objects.map((object) => [object.id, object]))
  const indices = input.characters.flatMap((character, index) =>
    character.hyphen && character.object !== null && objects.get(character.object)?.scope === null
      ? [index]
      : [],
  )
  if (!indices.length) return { characters: input.characters, recoveries: [] }
  if (indices.length > 16) throw new TypeError("hyphen-probe-limit")
  const replacements = new Map<number, number>()
  const recoveries: {
    readonly sourceObject: string
    readonly observedCodepoint: number
    readonly copyTarget: string
    readonly lineBreak: "geometry-verified"
  }[] = []
  for (const index of indices) {
    if (performance.now() >= input.deadline) throw new RangeError("probe-time-limit")
    const character = input.characters[index]
    const next = input.characters[index + 1]
    const object =
      character?.object === null || character?.object === undefined
        ? undefined
        : objects.get(character.object)
    const following =
      next?.object === null || next?.object === undefined ? undefined : objects.get(next.object)
    if (
      !object ||
      !following ||
      object.path.length !== 1 ||
      following.path.length !== 1 ||
      next?.generated ||
      object.id === following.id
    )
      throw new TypeError("unverified-hyphen-transformation")
    const original = input.characters.filter((row) => !row.generated && row.object === object.id)
    if (original.at(-1) !== character || original.filter((row) => row.hyphen).length !== 1)
      throw new TypeError("unverified-hyphen-transformation")
    const first = input.sourceIdentity(object.path)
    const second = input.sourceIdentity(following.path)
    if (!first.matrix.slice(0, 4).every((value, position) => value === second.matrix[position]))
      throw new TypeError("unverified-hyphen-line-break")
    const [a, b, , , x, y] = first.matrix
    const [, , , , nextX, nextY] = second.matrix
    if (
      a === undefined ||
      b === undefined ||
      x === undefined ||
      y === undefined ||
      nextX === undefined ||
      nextY === undefined ||
      Math.hypot(a, b) === 0 ||
      Math.abs((nextY - y) * a - (nextX - x) * b) <= 0.001
    )
      throw new TypeError("unverified-hyphen-line-break")
    const lineage = object.path.map((_, depth) =>
      input.sourceIdentity(object.path.slice(0, depth + 1)),
    )
    const probe = probeObjects(input.context, [{ ...object, lineage }], {
      deadline: input.deadline,
      stats: input.budget,
    }).get(object.id)
    if (!probe?.identityVerified || probe.characters.length !== original.length)
      throw new TypeError("unverified-hyphen-transformation")
    for (const [position, observed] of probe.characters.entries()) {
      const source = original[position]
      if (
        !source ||
        observed.generated ||
        observed.hyphen ||
        observed.mappingError ||
        observed.object !== probe.target
      )
        throw new TypeError("unverified-hyphen-transformation")
      if (position + 1 < original.length && observed.codepoint !== source.codepoint)
        throw new TypeError("unverified-hyphen-transformation")
    }
    const value = probe.characters.at(-1)?.codepoint
    if (value !== 0x2d && value !== 0xad) throw new TypeError("unverified-hyphen-transformation")
    replacements.set(index, value)
    recoveries.push({
      sourceObject: object.id,
      observedCodepoint: value,
      copyTarget: probe.target,
      lineBreak: "geometry-verified",
    })
  }
  return {
    characters: input.characters.flatMap((character, index): Character[] => {
      const codepoint = replacements.get(index)
      return codepoint === undefined
        ? [character]
        : [
            { ...character, codepoint, hyphen: false },
            { codepoint: 10, generated: true, hyphen: false, mappingError: false, object: null },
          ]
    }),
    recoveries,
  }
}
