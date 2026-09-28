import { posix } from "node:path"
import { SaxesParser } from "saxes"
import { safeEntryPath } from "./archive-policy.ts"

export class NormalizationError extends Error {
  override readonly name = "NormalizationError"
  constructor(
    readonly code: "unsafe-xml" | "invalid-xml" | "invalid-package" | "unsafe-reference",
  ) {
    super(code)
  }
}

export const XHTML = "http://www.w3.org/1999/xhtml"
export const EPUB = "http://www.idpf.org/2007/ops"
export type XmlNode = {
  readonly name: string
  readonly uri: string
  readonly attributes: ReadonlyMap<string, string>
  readonly children: (XmlNode | string)[]
}

export function xml(bytes: Uint8Array): XmlNode {
  const parser = new SaxesParser({ xmlns: true })
  const stack: XmlNode[] = []
  let root: XmlNode | undefined
  let nodes = 0
  parser.on("doctype", () => {
    throw new NormalizationError("unsafe-xml")
  })
  parser.on("error", () => {
    throw new NormalizationError("invalid-xml")
  })
  parser.on("opentag", (tag) => {
    if (++nodes > 100_000 || stack.length >= 128) throw new NormalizationError("unsafe-xml")
    const node: XmlNode = {
      name: tag.local,
      uri: tag.uri,
      attributes: new Map(
        Object.values(tag.attributes).map((attribute) => [
          attribute.uri ? `${attribute.uri}|${attribute.local}` : attribute.local,
          attribute.value,
        ]),
      ),
      children: [],
    }
    stack.at(-1)?.children.push(node)
    root ??= node
    stack.push(node)
  })
  const text = (value: string) => {
    stack.at(-1)?.children.push(value)
  }
  parser.on("text", text)
  parser.on("cdata", text)
  parser.on("closetag", () => {
    stack.pop()
  })
  try {
    parser.write(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).close()
  } catch (error) {
    if (error instanceof TypeError) throw new NormalizationError("invalid-xml")
    throw error
  }
  if (!root) throw new NormalizationError("invalid-xml")
  return root
}

export function children(node: XmlNode, name: string, uri = node.uri): XmlNode[] {
  return node.children.filter(
    (child): child is XmlNode =>
      typeof child !== "string" && child.name === name && child.uri === uri,
  )
}

export function reference(base: string, href: string) {
  if (
    /^[a-z][a-z\d+.-]*:|^\/|[\\?]/iu.test(href) ||
    [...href].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new NormalizationError("unsafe-reference")
  const hash = href.indexOf("#")
  const rawPath = hash < 0 ? href : href.slice(0, hash)
  try {
    const decoded = decodeURIComponent(rawPath)
    if (decoded.startsWith("/") || decoded.includes("\\"))
      throw new NormalizationError("unsafe-reference")
    const path = safeEntryPath(rawPath ? posix.join(posix.dirname(base), decoded) : base)
    return { path, ...(hash < 0 ? {} : { fragment: decodeURIComponent(href.slice(hash + 1)) }) }
  } catch (error) {
    if (error instanceof Error) throw new NormalizationError("unsafe-reference")
    throw error
  }
}
