import { describe, expect, it } from "vitest"
import {
  LANGUAGE_STORAGE_KEY,
  rememberLocale,
  resolveLocale,
  type StorageLike,
} from "./preference.ts"

function memory(initial?: string): StorageLike & { readonly writes: string[] } {
  const store = new Map<string, string>(
    initial === undefined ? [] : [[LANGUAGE_STORAGE_KEY, initial]],
  )
  const writes: string[] = []
  return {
    writes,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(value)
      store.set(key, value)
    },
  }
}

const throwingReads: StorageLike = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError")
  },
  setItem: () => undefined,
}
const throwingWrites: StorageLike = {
  getItem: () => null,
  setItem: () => {
    throw new DOMException("quota", "QuotaExceededError")
  },
}

describe("Given language resolution inputs", () => {
  it.each([
    ["no explicit, nothing remembered", null, undefined, "en", "default"],
    ["accepted explicit ja beats remembered en", "ja", "en", "ja", "explicit"],
    ["accepted explicit en beats remembered ja", "en", "ja", "en", "explicit"],
    ["unsupported explicit falls to remembered ja", "fr", "ja", "ja", "remembered"],
    ["empty explicit falls to remembered ja", "", "ja", "ja", "remembered"],
    ["unsupported explicit and nothing remembered", "JA", undefined, "en", "default"],
    ["malformed remembered value", null, '{"x":1}', "en", "default"],
    ["unsupported remembered value", null, "fr", "en", "default"],
  ] as const)(
    "When %s Then the effective choice follows precedence",
    (_name, explicit, remembered, locale, source) => {
      expect(resolveLocale(explicit, memory(remembered))).toEqual({ locale, source })
    },
  )

  it("When storage reads throw Then explicit still wins, otherwise English", () => {
    expect(resolveLocale("ja", throwingReads)).toEqual({ locale: "ja", source: "explicit" })
    expect(resolveLocale(null, throwingReads)).toEqual({ locale: "en", source: "default" })
  })

  it("When storage is unavailable altogether Then English is the default", () => {
    expect(resolveLocale(null, null)).toEqual({ locale: "en", source: "default" })
  })
})

describe("Given an accepted language choice", () => {
  it("When remembered Then the value is written under the language key", () => {
    const storage = memory()
    expect(rememberLocale(storage, "ja")).toBe("saved")
    expect(storage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ja")
  })

  it("When the write throws Then failure is reported, not claimed as saved", () => {
    expect(rememberLocale(throwingWrites, "ja")).toBe("failed")
  })

  it("When storage is unavailable Then failure is reported", () => {
    expect(rememberLocale(null, "ja")).toBe("failed")
  })

  it("When unsupported explicit values are resolved Then nothing is ever written", () => {
    const storage = memory()
    resolveLocale("fr", storage)
    expect(storage.writes).toEqual([])
  })
})
