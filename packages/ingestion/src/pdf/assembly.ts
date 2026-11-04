import { eligibleCjk, lastCharacter } from "./cjk.ts"
import type { ProbeObservation } from "./probe.ts"
import { hasRtlTransformRisk } from "./transformations.ts"

export type Scope = { readonly id: string; readonly text: string }
export type TextObject = { readonly id: string; readonly scope: Scope | null }
export type Character = {
  readonly codepoint: number
  readonly generated: boolean
  readonly object: string | null
  readonly mappingError: boolean
  readonly hyphen: boolean
}
export type PageInput = {
  readonly objects: readonly TextObject[]
  readonly characters: readonly Character[]
  readonly maximumCharacters: number
  readonly accounts?: readonly ObjectAccount[]
}
export type ObjectAccount = {
  readonly id: string
  readonly kind:
    | "represented"
    | "scope-covered"
    | "whitespace"
    | "empty-replacement"
    | "unexplained"
  readonly anchor?: string
  readonly reason?: string
  readonly probe?: ProbeObservation
}
export type Segment = {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly kind: "actual-text" | "generated" | "encoded"
  readonly object: string | null
  readonly scope: string | null
}

export function assemblePage(input: PageInput): {
  readonly text: string
  readonly emittedScopes: readonly string[]
  readonly segments: readonly Segment[]
} {
  if (input.objects.length > 20000 || input.characters.length > input.maximumCharacters)
    throw new RangeError("limit-exceeded")
  if (
    input.objects.length > 0 &&
    input.characters.length === 0 &&
    input.objects.every((object) => object.scope === null)
  )
    throw new TypeError("no-selectable-text")
  const objects = new Map(input.objects.map((object, index) => [object.id, { ...object, index }]))
  if (objects.size !== input.objects.length) throw new TypeError("ambiguous-text-object-instance")
  let previousOrder = -1
  const represented = new Set<string>()
  for (const character of input.characters) {
    if (character.mappingError) throw new TypeError("unicode-map-error")
    if (
      !Number.isInteger(character.codepoint) ||
      character.codepoint < 0 ||
      character.codepoint > 0x10ffff
    )
      throw new TypeError("invalid-unicode-scalar")
    if (character.generated) continue
    const object = character.object === null ? undefined : objects.get(character.object)
    if (!object) throw new TypeError("unknown-text-object")
    if (!object.scope && character.hyphen) throw new TypeError("unverified-hyphen-transformation")
    if (!object.scope && hasRtlTransformRisk(character.codepoint))
      throw new TypeError("unverified-rtl-transformation")
    if (object.index < previousOrder) throw new TypeError("ambiguous-object-order")
    previousOrder = object.index
    represented.add(object.id)
  }
  const accounts = new Map(input.accounts?.map((account) => [account.id, account]))
  for (const object of input.objects) {
    if (represented.has(object.id)) continue
    const account = accounts.get(object.id)
    if (!account) throw new TypeError("unaccounted-text-object")
    switch (account.kind) {
      case "scope-covered": {
        const anchor = account.anchor === undefined ? undefined : objects.get(account.anchor)
        if (
          !object.scope ||
          !anchor ||
          !represented.has(anchor.id) ||
          anchor.scope?.id !== object.scope.id
        )
          throw new TypeError("invalid-scope-account")
        break
      }
      case "whitespace":
        if (object.scope !== null) throw new TypeError("invalid-whitespace-account")
        break
      case "empty-replacement":
        if (object.scope?.text !== "") throw new TypeError("invalid-empty-replacement-account")
        break
      case "unexplained":
        throw new TypeError("unexplained-text-object")
      case "represented":
        throw new TypeError("invalid-represented-account")
      default: {
        const impossible: never = account.kind
        throw new TypeError(String(impossible))
      }
    }
  }
  const parts: string[] = []
  const segments: Segment[] = []
  const emitted = new Set<string>()
  let length = 0
  const append = (text: string, origin: Pick<Segment, "kind" | "object" | "scope">) => {
    const start = length
    length += text.length
    if (length > input.maximumCharacters) throw new RangeError("limit-exceeded")
    parts.push(text)
    if (text.length) segments.push({ start, end: length, text, ...origin })
  }
  const emitScope = (scope: Scope) => {
    if (emitted.has(scope.id)) return
    emitted.add(scope.id)
    append(scope.text, { kind: "actual-text", scope: scope.id, object: null })
  }
  let cursor = 0
  const flushBefore = (order: number) => {
    while (cursor < order) {
      const object = input.objects[cursor++]
      if (!object) throw new TypeError("unknown-text-object")
      if (object.scope && represented.has(object.id)) emitScope(object.scope)
    }
  }
  const nextObjects = new Array<TextObject | undefined>(input.characters.length)
  let nextObject: TextObject | undefined
  for (let index = input.characters.length - 1; index >= 0; index--) {
    const character = input.characters[index]
    if (character && !character.generated && character.object !== null)
      nextObject = objects.get(character.object)
    nextObjects[index] = nextObject
  }
  let previousScope: Scope | null = null
  for (let index = 0; index < input.characters.length; index++) {
    const character = input.characters[index]
    if (!character) throw new TypeError("missing-character")
    if (character.generated) {
      const following = nextObjects[index]
      if (following) flushBefore(objects.get(following.id)?.index ?? cursor)
      if (previousScope && following?.scope?.id === previousScope.id) continue
      const next = input.characters[index + 1]
      if (character.codepoint === 13 && next?.generated && next.codepoint === 10) {
        const after = input.characters[index + 2]
        const afterObject =
          after?.object === null || after?.object === undefined
            ? undefined
            : objects.get(after.object)
        const head = afterObject?.scope
          ? emitted.has(afterObject.scope.id)
            ? ""
            : String.fromCodePoint(afterObject.scope.text.codePointAt(0) ?? 0)
          : after
            ? String.fromCodePoint(after.codepoint)
            : ""
        if (
          !after ||
          after.generated ||
          !eligibleCjk(lastCharacter(parts.at(-1) ?? "")) ||
          !eligibleCjk(head)
        )
          append("\n", { kind: "generated", scope: null, object: null })
        index++
      } else
        append(String.fromCodePoint(character.codepoint), {
          kind: "generated",
          scope: null,
          object: null,
        })
      continue
    }
    const object = character.object === null ? undefined : objects.get(character.object)
    if (!object) throw new TypeError("unknown-text-object")
    flushBefore(object.index)
    cursor = object.index + 1
    if (object.scope) emitScope(object.scope)
    else {
      const value = character.codepoint
      if (value >= 0xd800 && value <= 0xdbff) {
        const next = input.characters[index + 1]
        if (
          !next ||
          next.generated ||
          next.object !== object.id ||
          next.codepoint < 0xdc00 ||
          next.codepoint > 0xdfff
        )
          throw new TypeError("invalid-unicode-scalar")
        append(String.fromCharCode(value, next.codepoint), {
          kind: "encoded",
          scope: null,
          object: object.id,
        })
        index++
      } else {
        if (value >= 0xdc00 && value <= 0xdfff) throw new TypeError("invalid-unicode-scalar")
        append(String.fromCodePoint(value), { kind: "encoded", scope: null, object: object.id })
      }
    }
    previousScope = object.scope
  }
  flushBefore(input.objects.length)
  return { text: parts.join(""), emittedScopes: [...emitted], segments }
}
