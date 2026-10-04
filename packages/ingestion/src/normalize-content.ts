import { children, EPUB, NormalizationError, XHTML, type XmlNode } from "./normalize-xml.ts"

export type TextBlock = {
  readonly text: string
  readonly fragment?: string
  readonly heading?: number
  readonly pageLabel?: string
}
const blocked = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "template",
  "link",
  "meta",
  "img",
  "audio",
  "video",
  "source",
])
const boundaries = new Set([
  "p",
  "div",
  "section",
  "article",
  "li",
  "blockquote",
  "pre",
  "tr",
  "dt",
  "dd",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
])

export function chapterContent(root: XmlNode) {
  if (root.name !== "html" || root.uri !== XHTML) throw new NormalizationError("invalid-xml")
  const body = children(root, "body")[0]
  if (!body) throw new NormalizationError("invalid-xml")
  const blocks: TextBlock[] = []
  const omitted: string[] = []
  let text = ""
  let pageLabel: string | undefined
  let context: { readonly fragment?: string; readonly heading?: number } = {}
  const flush = () => {
    const normalized = text.replace(/\s+/gu, " ").trim()
    if (normalized)
      blocks.push({
        text: normalized,
        ...context,
        ...(pageLabel === undefined ? {} : { pageLabel }),
      })
    text = ""
  }
  const visit = (node: XmlNode) => {
    if (node.uri !== XHTML || blocked.has(node.name)) {
      omitted.push(node.name)
      return
    }
    const previous = context
    const fragment =
      node.attributes.get("id") ?? node.attributes.get("http://www.w3.org/XML/1998/namespace|id")
    const boundary = boundaries.has(node.name) || fragment !== undefined
    if (boundary) flush()
    const blockStart = blocks.length
    const heading = /^h[1-6]$/u.test(node.name) ? Number(node.name.slice(1)) : context.heading
    context = {
      ...context,
      ...(fragment === undefined ? {} : { fragment }),
      ...(heading === undefined ? {} : { heading }),
    }
    if (
      node.attributes.get(`${EPUB}|type`)?.split(/\s+/u).includes("pagebreak") ||
      node.attributes.get("role") === "doc-pagebreak"
    ) {
      flush()
      pageLabel =
        node.attributes.get("title") ??
        node.attributes.get("aria-label") ??
        node.children
          .filter((child) => typeof child === "string")
          .join("")
          .trim()
      blocks.push({ text: "", ...context, pageLabel })
    } else {
      if (node.name === "br") text += " "
      for (const child of node.children) {
        if (typeof child === "string") text += child
        else visit(child)
      }
    }
    if (boundary) flush()
    if (
      fragment !== undefined &&
      !blocks.slice(blockStart).some((block) => block.fragment === fragment)
    ) {
      blocks.splice(blockStart, 0, {
        text: "",
        fragment,
        ...(pageLabel === undefined ? {} : { pageLabel }),
      })
    }
    context = previous
  }
  visit(body)
  flush()
  return { blocks, omitted }
}
