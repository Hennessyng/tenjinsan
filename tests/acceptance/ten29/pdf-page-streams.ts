import { readFile, writeFile } from "node:fs/promises"
import { basename, isAbsolute, join } from "node:path"
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib"
import { z } from "zod"

const directory = z
  .string()
  .refine(isAbsolute)
  .refine((path) => /^ten29-pdf-provenance-[a-zA-Z0-9]+$/u.test(basename(path)))
  .parse(process.argv[2])
const document = await PDFDocument.load(await readFile(join(directory, "mixed.pdf")))
for (const [index, page] of document.getPages().entries()) {
  const contents = page.node.Contents()
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().flatMap((ref) => {
          const stream = document.context.lookup(ref)
          return stream instanceof PDFRawStream ? [stream] : []
        })
      : contents instanceof PDFRawStream
        ? [contents]
        : []
  for (const [part, stream] of streams.entries())
    await writeFile(
      join(directory, `page-${index + 1}-stream-${part + 1}.txt`),
      decodePDFRawStream(stream).decode(),
      { mode: 0o600, flag: "wx" },
    )
}
