import { PublicationProjection } from "@reading-studio/contracts"
import { ContractBoundaryError } from "@reading-studio/storage"

export function correctProjection(
  projection: PublicationProjection,
  change: {
    readonly path: string
    readonly text?: string
  },
) {
  if (
    change.text === undefined &&
    !/^\/sections\/\d+(?:\/(?:scenes|practice|sourceNotes)\/\d+)?$/u.test(change.path)
  )
    throw new ContractBoundaryError("removable projected content")
  let found = false
  const visit = (value: unknown, path: string): unknown => {
    if (path === change.path) {
      found = true
      if (change.text !== undefined && typeof value !== "string")
        throw new ContractBoundaryError("projected text correction")
      return change.text
    }
    if (Array.isArray(value))
      return value
        .map((item: unknown, index) => visit(item, `${path}/${index}`))
        .filter((item) => item !== undefined)
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]: [string, unknown]) => [
          key,
          visit(item, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`),
        ]),
      )
    return value
  }
  const result = visit(projection, "")
  if (!found) throw new ContractBoundaryError("missing projection path")
  return PublicationProjection.parse(result)
}
