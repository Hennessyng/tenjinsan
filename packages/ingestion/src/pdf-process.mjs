import { readFileSync } from "node:fs"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"

const limits = JSON.parse(process.argv[2])
const bytes = new Uint8Array(readFileSync(0))
const respond = (value) => process.stdout.write(JSON.stringify(value))
let task
try {
  if (bytes.length > limits.bytes) throw new RangeError("limit")
  globalThis.fetch = () => {
    throw new TypeError("External resources disabled")
  }
  task = getDocument({
    data: bytes,
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
    maxImageSize: 0,
    verbosity: 0,
  })
  const document = await task.promise
  if (document.numPages > limits.pages) throw new RangeError("limit")
  const pages = []
  let characters = 0
  for (let page = 1; page <= document.numPages; page++) {
    const source = await document.getPage(page)
    const content = await source.getTextContent({ disableNormalization: true })
    const text = content.items
      .filter((item) => "str" in item)
      .map((item) => item.str + (item.hasEOL ? "\n" : " "))
      .join("")
      .trimEnd()
    characters += text.length
    if (characters > limits.characters) throw new RangeError("limit")
    pages.push(text)
    source.cleanup()
  }
  respond({ pages })
} catch (error) {
  if (error instanceof RangeError) respond({ error: "limit-exceeded" })
  else if (error instanceof Error && error.name === "PasswordException")
    respond({ error: "protected-document" })
  else if (
    error instanceof Error &&
    ["InvalidPDFException", "UnknownErrorException", "FormatError"].includes(error.name)
  )
    respond({ error: "invalid-pdf" })
  else throw error
} finally {
  await task?.destroy()
}
