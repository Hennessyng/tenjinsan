import { crc32, deflateRawSync } from "node:zlib"

type ZipFixtureEntry = {
  readonly name: string
  readonly text: string
  readonly deflate?: boolean
  readonly flags?: number
  readonly localName?: string
  readonly unicodeName?: string
  readonly size?: number
  readonly mode?: number
}

// Write real ZIP records directly so hostile metadata is not sanitized by a ZIP writer.
export function zipFixture(entries: readonly ZipFixtureEntry[]): Buffer<ArrayBuffer> {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const localName = Buffer.from(entry.localName ?? entry.name)
    const unicodeName = entry.unicodeName === undefined ? undefined : Buffer.from(entry.unicodeName)
    const extra = Buffer.alloc(unicodeName === undefined ? 0 : 9 + unicodeName.length)
    if (unicodeName !== undefined) {
      extra.writeUInt16LE(0x7075)
      extra.writeUInt16LE(5 + unicodeName.length, 2)
      extra[4] = 1
      extra.writeUInt32LE(crc32(name), 5)
      unicodeName.copy(extra, 9)
    }
    const data = Buffer.from(entry.text)
    const compressed = entry.deflate ? deflateRawSync(data) : data
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(entry.flags ?? 0x800, 6)
    header.writeUInt16LE(entry.deflate ? 8 : 0, 8)
    header.writeUInt32LE(crc32(data), 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(entry.size ?? data.length, 22)
    header.writeUInt16LE(localName.length, 26)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50)
    directory.writeUInt16LE(0x314, 4)
    header.copy(directory, 6, 4, 26)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt16LE(extra.length, 30)
    directory.writeUInt32LE(((entry.mode ?? 0o100600) * 65536) >>> 0, 38)
    directory.writeUInt32LE(offset, 42)
    locals.push(header, localName, compressed)
    central.push(directory, name, extra)
    offset += header.length + localName.length + compressed.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

export const epubEntries = [
  { name: "mimetype", text: "application/epub+zip" },
  {
    name: "META-INF/container.xml",
    text: '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  },
  {
    name: "book/chapter.xhtml",
    text: '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Synthetic chapter</title></head><body><h1>Synthetic chapter</h1><p>Archive safety fixture.</p></body></html>',
  },
  {
    name: "book/package.opf",
    text: '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:ea8909ba-90dc-46f5-957a-aa7b7bb8bdc5</dc:identifier><dc:title>Synthetic fixture</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-23T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
  },
  {
    name: "book/nav.xhtml",
    text: '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Chapter</a></li></ol></nav></body></html>',
  },
] as const

export function encryptionFixture(
  uri: string,
  algorithm = "http://www.w3.org/2001/04/xmlenc#aes256",
): string {
  return `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="${algorithm}"/><CipherData><CipherReference URI="${uri}"/></CipherData></EncryptedData></encryption>`
}
