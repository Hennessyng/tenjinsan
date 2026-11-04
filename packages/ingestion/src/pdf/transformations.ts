const rtl = /[\p{Script=Hebrew}\p{Script=Arabic}\u200e\u200f\u202a-\u202e\u2066-\u2069]/u

export function hasRtlTransformRisk(codepoint: number): boolean {
  return rtl.test(String.fromCodePoint(codepoint))
}
