import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

export async function syntheticEpub(): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "reading-synthetic-epub-"))
  try {
    await mkdir(join(directory, "META-INF"))
    await mkdir(join(directory, "book"))
    await writeFile(join(directory, "mimetype"), "application/epub+zip")
    await writeFile(
      join(directory, "META-INF/container.xml"),
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    )
    await writeFile(
      join(directory, "book/package.opf"),
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:ea8909ba-90dc-46f5-957a-aa7b7bb8bdc5</dc:identifier><dc:title>Synthetic attention journal</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-23T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
    )
    await writeFile(
      join(directory, "book/chapter.xhtml"),
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>A small question</title></head><body><h1>A small question</h1><p>TASK31_SYNTHETIC_SOURCE_v1. Listen before guessing. A question opens room for correction. Ask what a companion heard.</p><p>A second question changes how we listen together.</p></body></html>',
    )
    await writeFile(
      join(directory, "book/nav.xhtml"),
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">A small question</a></li></ol></nav></body></html>',
    )
    const target = join(directory, "synthetic.epub")
    await exec("zip", ["-X", "-0", target, "mimetype"], { cwd: directory })
    await exec(
      "zip",
      [
        "-X",
        target,
        "META-INF/container.xml",
        "book/package.opf",
        "book/chapter.xhtml",
        "book/nav.xhtml",
      ],
      { cwd: directory },
    )
    return await readFile(target)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}
