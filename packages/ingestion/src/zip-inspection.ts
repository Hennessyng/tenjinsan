import type { FileHandle } from "node:fs/promises"
import { ERR_INVALID_UNCOMPRESSED_SIZE, Reader, ZipReader } from "@zip.js/zip.js"
import { ArchiveError, type ArchiveLimits, safeEntryPath } from "./archive-policy.ts"
import { inspectEncryption } from "./encryption.ts"

class FileReader extends Reader<FileHandle> {
  constructor(
    private readonly file: FileHandle,
    size: number,
  ) {
    super(file)
    this.size = size
  }

  override async readUint8Array(offset: number, length: number): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > this.size
    ) {
      throw new ArchiveError("invalid-archive")
    }
    const bytes = new Uint8Array(length)
    let read = 0
    while (read < length) {
      const result = await this.file.read(bytes, read, length - read, offset + read)
      if (result.bytesRead === 0) throw new ArchiveError("invalid-archive")
      read += result.bytesRead
    }
    return bytes
  }
}

async function inspectDirectory(reader: FileReader, limits: ArchiveLimits): Promise<number> {
  const size = Math.min(reader.size, 65557)
  const tail = Buffer.from(await reader.readUint8Array(reader.size - size, size))
  let end = tail.length - 22
  while (
    end >= 0 &&
    (tail.readUInt32LE(end) !== 0x06054b50 ||
      end + 22 + tail.readUInt16LE(end + 20) !== tail.length)
  )
    end--
  if (end < 0) throw new ArchiveError("invalid-archive")
  const count = tail.readUInt16LE(end + 10)
  const length = tail.readUInt32LE(end + 12)
  const offset = tail.readUInt32LE(end + 16)
  if (count > limits.entries) throw new ArchiveError("limit-exceeded")
  if (
    tail.readUInt32LE(end + 4) !== 0 ||
    tail.readUInt16LE(end + 8) !== count ||
    offset + length !== reader.size - size + end
  ) {
    throw new ArchiveError("invalid-archive")
  }
  let cursor = offset
  for (let index = 0; index < count; index++) {
    const header = Buffer.from(await reader.readUint8Array(cursor, 46))
    if (header.readUInt32LE(0) !== 0x02014b50) throw new ArchiveError("invalid-archive")
    cursor += 46 + header.readUInt16LE(28) + header.readUInt16LE(30) + header.readUInt16LE(32)
    if (cursor > offset + length) throw new ArchiveError("invalid-archive")
  }
  if (cursor !== offset + length) throw new ArchiveError("invalid-archive")
  return offset
}

export async function inspectZip(
  file: FileHandle,
  options: {
    readonly bytes: number
    readonly limits: ArchiveLimits
    readonly capture?: Map<string, Uint8Array>
  },
) {
  const reader = new FileReader(file, options.bytes)
  const zip = new ZipReader(reader, {
    useWebWorkers: false,
    checkSignature: true,
    checkOverlappingEntry: true,
  })
  const files = new Set<string>()
  const paths = new Set<string>()
  let expanded = 0
  let declared = 0
  let entries = 0
  let mimetype = ""
  let encryption: string | undefined
  try {
    const directoryOffset = await inspectDirectory(reader, options.limits)
    for await (const entry of zip.getEntriesGenerator()) {
      entries++
      if (entries > options.limits.entries) throw new ArchiveError("limit-exceeded")
      const name = safeEntryPath(entry.filename)
      safeEntryPath(Buffer.from(entry.rawFilename).toString("latin1"))
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000
      if (paths.has(name) || (mode !== 0 && mode !== 0o100000 && mode !== 0o040000))
        throw new ArchiveError("unsafe-path")
      paths.add(name)
      if (entry.encrypted) throw new ArchiveError("encrypted-content")
      declared += entry.uncompressedSize
      if (
        entry.uncompressedSize > options.limits.entryBytes ||
        declared > options.limits.decompressedBytes ||
        entry.compressedSize > options.limits.compressedBytes
      )
        throw new ArchiveError("limit-exceeded")
      const local = Buffer.from(await reader.readUint8Array(entry.offset, 30))
      if (local.readUInt32LE(0) !== 0x04034b50) throw new ArchiveError("invalid-archive")
      if (local.readUInt16LE(6) & 0x41) throw new ArchiveError("encrypted-content")
      const localName = await reader.readUint8Array(entry.offset + 30, local.readUInt16LE(26))
      if (
        !Buffer.from(localName).equals(entry.rawFilename) ||
        local.readUInt16LE(8) !== entry.compressionMethod ||
        entry.offset + 30 + localName.length + local.readUInt16LE(28) + entry.compressedSize >
          directoryOffset
      )
        throw new ArchiveError("invalid-archive")
      if (entry.directory) {
        if (entry.uncompressedSize !== 0 || entry.compressedSize !== 0)
          throw new ArchiveError("invalid-archive")
        continue
      }
      files.add(name)
      let entryBytes = 0
      const metadata = name === "mimetype" || name === "META-INF/encryption.xml"
      const chunks: Buffer[] = []
      const output = new WritableStream<Uint8Array>({
        write(chunk) {
          entryBytes += chunk.byteLength
          expanded += chunk.byteLength
          if (
            entryBytes > options.limits.entryBytes ||
            expanded > options.limits.decompressedBytes ||
            (metadata && entryBytes > 1024 * 1024)
          )
            throw new ArchiveError("limit-exceeded")
          if (metadata || options.capture) chunks.push(Buffer.from(chunk))
        },
      })
      await entry.getData(output, { preventClose: true })
      await output.close()
      if (entryBytes !== entry.uncompressedSize) throw new ArchiveError("invalid-archive")
      options.capture?.set(name, Buffer.concat(chunks))
      if (name === "mimetype") mimetype = Buffer.concat(chunks).toString("utf8")
      if (name === "META-INF/encryption.xml") {
        encryption = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
      }
    }
    if (mimetype !== "application/epub+zip" || !files.has("META-INF/container.xml"))
      throw new ArchiveError("invalid-epub")
    if (encryption !== undefined) inspectEncryption(encryption, files)
    return { entries, decompressedBytes: expanded }
  } catch (error) {
    if (error instanceof ArchiveError) throw error
    if (error instanceof Error && error.message === ERR_INVALID_UNCOMPRESSED_SIZE)
      throw new ArchiveError("limit-exceeded")
    if (error instanceof Error) throw new ArchiveError("invalid-archive", { cause: error })
    throw error
  } finally {
    await zip.close()
  }
}
