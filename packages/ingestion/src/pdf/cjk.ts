const script = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
export function eligibleCjk(character: string): boolean {
  const point = character.codePointAt(0)
  if (point === undefined || !script.test(character)) return false
  return (
    (point >= 0x2e80 && point <= 0xa4cf) ||
    (point >= 0xf900 && point <= 0xfaff) ||
    (point >= 0x1b000 && point <= 0x1b16f) ||
    (point >= 0x20000 && point <= 0x323af)
  )
}

export function lastCharacter(text: string): string {
  const last = text.charCodeAt(text.length - 1)
  return last >= 0xdc00 && last <= 0xdfff ? text.slice(-2) : text.slice(-1)
}
