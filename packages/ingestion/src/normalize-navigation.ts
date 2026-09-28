import { children, EPUB, reference, XHTML, type XmlNode } from "./normalize-xml.ts"

const NCX = "http://www.daisy.org/z3986/2005/ncx/"
const DTBOOK = "http://www.daisy.org/z3986/2005/dtbook/"
const labelElements = new Set([
  "a",
  "span",
  "em",
  "strong",
  "b",
  "i",
  "u",
  "s",
  "small",
  "sub",
  "sup",
  "abbr",
  "acronym",
  "bdi",
  "bdo",
  "cite",
  "code",
  "dfn",
  "kbd",
  "mark",
  "q",
  "samp",
  "var",
  "ruby",
  "rt",
  "rp",
  "br",
  "wbr",
  "sent",
  "w",
])

function labelText(node: XmlNode): string {
  const allowed =
    node.uri === NCX
      ? node.name === "navLabel" || node.name === "text"
      : (node.uri === XHTML || node.uri === DTBOOK) && labelElements.has(node.name)
  if (!allowed) return ""
  if (node.name === "br") return " "
  return node.children
    .map((child) => (typeof child === "string" ? child : labelText(child)))
    .join("")
}

export type NavigationItem = {
  readonly path: string
  readonly fragment?: string
  readonly label: string
  readonly depth: number
}

export function navigation(root: XmlNode, path: string) {
  const toc: NavigationItem[] = []
  const pages: NavigationItem[] = []
  const walk = (node: XmlNode, target: NavigationItem[] | undefined, depth: number) => {
    if (node.uri !== XHTML && node.uri !== NCX) return
    if (["script", "style", "iframe", "object", "template"].includes(node.name)) return
    let destination = target
    let level = depth
    const types = node.attributes.get(`${EPUB}|type`)?.split(/\s+/u) ?? []
    if (node.name === "navMap" || (node.name === "nav" && types.includes("toc"))) destination = toc
    if (node.name === "pageList" || (node.name === "nav" && types.includes("page-list")))
      destination = pages
    if (node.name === "ol") level++
    if (destination && node.name === "a") {
      const href = node.attributes.get("href")
      if (href)
        destination.push({
          ...reference(path, href),
          label: labelText(node).replace(/\s+/gu, " ").trim(),
          depth: Math.max(0, level - 1),
        })
    }
    if (destination && (node.name === "navPoint" || node.name === "pageTarget")) {
      const href = children(node, "content")[0]?.attributes.get("src")
      const label = children(node, "navLabel")[0]
      if (href && label)
        destination.push({
          ...reference(path, href),
          label: labelText(label).replace(/\s+/gu, " ").trim(),
          depth: level,
        })
      level++
    }
    for (const child of node.children)
      if (typeof child !== "string") walk(child, destination, level)
  }
  walk(root, undefined, 0)
  return { navigation: toc, pages }
}
