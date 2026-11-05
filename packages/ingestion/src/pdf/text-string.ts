export function decodePdfTextString(bytes: Uint8Array, maximumCharacters: number): string {
  let text: string
  if (bytes[0] === 254 && bytes[1] === 255) {
    if (bytes.length % 2) throw new TypeError("Malformed PDF UTF16BE string")
    if ((bytes.length - 2) / 2 > maximumCharacters) throw new RangeError("limit-exceeded")
    const swapped = bytes.slice(2)
    for (let index = 0; index < swapped.length; index += 2) {
      const first = swapped[index]
      const second = swapped[index + 1]
      if (first === undefined || second === undefined)
        throw new TypeError("Malformed PDF UTF16BE pair")
      swapped[index] = second
      swapped[index + 1] = first
    }
    text = new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(swapped)
  } else if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(3))
  } else {
    if (bytes.some((value) => value >= 128 || (value >= 24 && value <= 31)))
      throw new TypeError("unsupported-pdf-string-encoding")
    text = new TextDecoder("ascii", { fatal: true, ignoreBOM: true }).decode(bytes)
  }
  if (text.length > maximumCharacters) throw new RangeError("limit-exceeded")
  return text
}
