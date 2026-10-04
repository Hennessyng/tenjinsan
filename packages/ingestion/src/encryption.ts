import { SaxesParser } from "saxes"
import { ArchiveError, safeEntryPath } from "./archive-policy.ts"

const CONTAINER = "urn:oasis:names:tc:opendocument:xmlns:container"
const XMLENC = "http://www.w3.org/2001/04/xmlenc#"
const FONT_ALGORITHMS = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
])

export function inspectEncryption(xml: string, files: ReadonlySet<string>): void {
  const parser = new SaxesParser({ xmlns: true })
  const stack: string[] = []
  let algorithm: string | undefined
  let target: string | undefined
  parser.on("doctype", () => {
    throw new ArchiveError("invalid-encryption")
  })
  parser.on("error", () => {
    throw new ArchiveError("invalid-encryption")
  })
  parser.on("opentag", (tag) => {
    const parent = stack.at(-1)
    const attribute = (name: string) =>
      Object.values(tag.attributes).find((value) => value.local === name && value.uri === "")?.value
    if (stack.length === 0) {
      if (tag.local !== "encryption" || tag.uri !== CONTAINER)
        throw new ArchiveError("invalid-encryption")
    } else if (tag.uri !== XMLENC) {
      throw new ArchiveError("invalid-encryption")
    } else {
      switch (tag.local) {
        case "EncryptedData":
          if (parent !== "encryption") throw new ArchiveError("invalid-encryption")
          algorithm = undefined
          target = undefined
          break
        case "EncryptionMethod":
          if (parent !== "EncryptedData" || algorithm !== undefined)
            throw new ArchiveError("invalid-encryption")
          algorithm = attribute("Algorithm")
          break
        case "CipherData":
          if (parent !== "EncryptedData") throw new ArchiveError("invalid-encryption")
          break
        case "CipherReference":
          if (parent !== "CipherData" || target !== undefined)
            throw new ArchiveError("invalid-encryption")
          target = attribute("URI")
          break
        default:
          throw new ArchiveError("invalid-encryption")
      }
    }
    stack.push(tag.local)
  })
  parser.on("closetag", (tag) => {
    if (tag.local === "EncryptedData") {
      if (!algorithm || !target) throw new ArchiveError("invalid-encryption")
      let decoded: string
      try {
        decoded = decodeURIComponent(target)
      } catch (error) {
        if (error instanceof URIError) throw new ArchiveError("invalid-encryption")
        throw error
      }
      const path = safeEntryPath(decoded)
      if (
        !FONT_ALGORITHMS.has(algorithm) ||
        !/\.(otf|ttf|woff2?)$/iu.test(path) ||
        !files.has(path)
      ) {
        throw new ArchiveError("encrypted-content")
      }
    }
    stack.pop()
  })
  parser.write(xml).close()
}
