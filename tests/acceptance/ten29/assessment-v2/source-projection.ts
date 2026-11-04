import { createHash } from "node:crypto"
import type { NormalizationRevision } from "@reading-studio/contracts"
import type { Family } from "../corpus-support.ts"
export type Location = {
  readonly resourcePath: string
  readonly blockId: string
  readonly start: number
  readonly end: number
}
type Unit = {
  readonly char: string
  readonly locations: readonly Location[]
  readonly boundary: boolean
}
export const hashText = (text: string) => createHash("sha256").update(text).digest("hex")
export const canonicalText = (text: string) => text.replace(/\s+/gu, " ").trim()
export function projectSource(family: Family, normalization: NormalizationRevision) {
  if (normalization.coverage !== "complete" || (normalization.omissions?.length ?? 0))
    throw new TypeError("Source equivalence requires complete extraction")
  const raw: Unit[] = []
  for (const resource of normalization.resources)
    if (resource.status === "included")
      for (const block of resource.blocks) {
        if (raw.length) raw.push({ char: "\n", locations: [], boundary: true })
        let offset = 0
        for (const char of block.text) {
          raw.push({
            char,
            locations: [
              {
                resourcePath: resource.path,
                blockId: block.id,
                start: offset,
                end: offset + char.length,
              },
            ],
            boundary: false,
          })
          offset += char.length
        }
      }
  const units: Unit[] = []
  for (const unit of raw) {
    if (/\s/u.test(unit.char)) {
      if (!units.length) continue
      const previous = units.at(-1)
      if (previous?.char === " ")
        units[units.length - 1] = {
          char: " ",
          locations: [...previous.locations, ...unit.locations],
          boundary: previous.boundary || unit.boundary,
        }
      else units.push({ ...unit, char: " " })
    } else units.push(unit)
  }
  if (units.at(-1)?.char === " ") units.pop()
  const actual = units.map((unit) => unit.char).join("")
  if (actual !== family.parts.map((part) => canonicalText(part.text)).join(" "))
    throw new TypeError("Ordered source canonical-unit bijection failed")
  let cursor = 0
  const parts = family.parts.map((part, ordinal) => {
    const count = Array.from(canonicalText(part.text)).length,
      startUnit = cursor
    const selected = units.slice(cursor, cursor + count)
    cursor += count + 1
    const locations: Location[] = []
    for (const unit of selected)
      for (const location of unit.locations) {
        const previous = locations.at(-1)
        if (
          previous &&
          previous.resourcePath === location.resourcePath &&
          previous.blockId === location.blockId &&
          previous.end === location.start
        )
          locations[locations.length - 1] = { ...previous, end: location.end }
        else locations.push(location)
      }
    if (!locations.length) throw new TypeError("Part lost all original locations")
    const excerpts = locations.map((location) => {
      const resource = normalization.resources.find((row) => row.path === location.resourcePath)
      const block =
        resource?.status === "included"
          ? resource.blocks.find((row) => row.id === location.blockId)
          : undefined
      if (!block) throw new TypeError("Missing mapped source block")
      return { ...location, text: block.text.slice(location.start, location.end) }
    })
    const text = selected.map((unit) => unit.char).join("")
    if (canonicalText(excerpts.map((entry) => entry.text).join(" ")) !== text)
      throw new TypeError("Original excerpt reconstruction failed")
    return {
      ordinal,
      startUnit,
      endUnit: startUnit + count,
      canonicalText: text,
      canonicalSha256: hashText(text),
      locations,
      excerpts,
    }
  })
  if (cursor - 1 !== units.length) throw new TypeError("Unaccounted canonical units")
  return {
    canonicalText: actual,
    canonicalSha256: hashText(actual),
    canonicalUnits: units.length,
    rawHashIsNotEquivalence: true,
    normalizationId: normalization.id,
    parts,
    unitMap: units,
  }
}
export type SourceProjection = ReturnType<typeof projectSource>
