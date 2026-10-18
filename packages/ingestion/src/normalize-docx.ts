import type { FileHandle } from "node:fs/promises"
import { ResourcePath } from "@reading-studio/contracts"
import type { DocumentBlock, ExtractedDocument } from "./document-model.ts"
import { DOCUMENT_LIMITS } from "./document-policy.ts"
import { children, NormalizationError, reference, type XmlNode, xml } from "./normalize-xml.ts"
import { inspectZip } from "./zip-inspection.ts"

const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
const REL = "http://schemas.openxmlformats.org/package/2006/relationships"
const OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
const ancillary = /^word\/(header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/u
const metadata = /^word\/(styles|numbering|settings|fontTable|webSettings|theme\/[^/]+)\.xml$/u

function partText(root: XmlNode, part: string) {
  const blocks: DocumentBlock[] = []
  const omitted = new Set<string>()
  let paragraph = 0
  const visit = (node: XmlNode, table = false) => {
    if (node.uri !== WORD) {
      omitted.add("foreign-content")
      return
    }
    if (
      ["object", "drawing", "pict", "altChunk", "txbxContent", "del", "instrText"].includes(
        node.name,
      )
    ) {
      omitted.add(node.name)
      return
    }
    if (node.name === "p") {
      paragraph++
      let text = ""
      const collect = (child: XmlNode) => {
        if (child.uri !== WORD) {
          omitted.add("foreign-content")
          return
        }
        if (["object", "drawing", "pict", "txbxContent", "del", "instrText"].includes(child.name)) {
          omitted.add(child.name)
          return
        }
        if (child.name === "t")
          text += child.children.filter((item) => typeof item === "string").join("")
        else if (child.name === "tab") text += "\t"
        else if (child.name === "br" || child.name === "cr") text += "\n"
        else for (const item of child.children) if (typeof item !== "string") collect(item)
      }
      collect(node)
      if (!text.trim()) return
      const properties = children(node, "pPr")[0]
      const style = properties && children(properties, "pStyle")[0]?.attributes.get(`${WORD}|val`)
      const heading = style && /^Heading[1-6]$/iu.test(style) ? Number(style.slice(-1)) : undefined
      blocks.push({
        text,
        structure: table
          ? "table-cell"
          : properties && children(properties, "numPr").length
            ? "list-item"
            : "paragraph",
        ...(heading ? { heading } : {}),
        locator: { kind: "docx", part: ResourcePath.parse(part), paragraph },
      })
      return
    }
    for (const child of node.children)
      if (typeof child !== "string") visit(child, table || node.name === "tc")
  }
  visit(root)
  return { blocks, omitted }
}

export async function normalizeDocx(file: FileHandle): Promise<ExtractedDocument> {
  const files = new Map<string, Uint8Array>()
  await inspectZip(file, {
    bytes: (await file.stat()).size,
    limits: DOCUMENT_LIMITS.docx,
    capture: files,
    format: "docx",
  })
  const documents = new Map<string, XmlNode>()
  for (const [path, bytes] of files)
    if (path.endsWith(".xml") || path.endsWith(".rels")) documents.set(path, xml(bytes))
  const types = documents.get("[Content_Types].xml")
  if (
    types?.name !== "Types" ||
    types.uri !== "http://schemas.openxmlformats.org/package/2006/content-types"
  )
    throw new NormalizationError("invalid-package")
  let main: string | undefined
  for (const [path, root] of documents) {
    if (root.uri === WORD && children(root, "documentProtection").length)
      throw new NormalizationError("protected-document")
    if (!path.endsWith(".rels")) continue
    if (root.name !== "Relationships" || root.uri !== REL)
      throw new NormalizationError("invalid-package")
    for (const rel of children(root, "Relationship")) {
      const target = rel.attributes.get("Target")
      if (!target || rel.attributes.get("TargetMode") === "External")
        throw new NormalizationError("unsafe-reference")
      const base =
        path === "_rels/.rels" ? "root" : path.replace("/_rels/", "/").replace(/\.rels$/u, "")
      const resolved = reference(base, target).path
      if (path === "_rels/.rels" && rel.attributes.get("Type") === OFFICE) main = resolved
    }
  }
  const body = main && documents.get(main)
  if (!main || !body || body.name !== "document" || body.uri !== WORD)
    throw new NormalizationError("invalid-package")
  const chapters: ExtractedDocument["chapters"][number][] = []
  const skipped: ExtractedDocument["skipped"][number][] = []
  for (const path of [main, ...[...files.keys()].filter((path) => path !== main).sort()]) {
    const root = documents.get(path)
    if (root && (path === main || ancillary.test(path))) {
      const content = partText(root, path)
      chapters.push({
        path,
        role: path === main ? "main-chapter" : "supplementary",
        blocks: content.blocks,
      })
      if (content.blocks.length === 0)
        skipped.push({
          path,
          role: path === main ? "main-chapter" : "supplementary",
          reason: "empty-text",
        })
      for (const reason of content.omitted) skipped.push({ path, reason: `removed:${reason}` })
    } else if (path !== "[Content_Types].xml" && !path.endsWith(".rels") && !metadata.test(path)) {
      skipped.push({ path, role: "supplementary", reason: "unsupported-part" })
    }
  }
  return { chapters, skipped, pages: [], coverage: skipped.length ? "partial" : "complete" }
}
