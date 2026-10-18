import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { type Catalog, catalogs, translate, validateCatalogs } from "../src/i18n/index.ts"

const repoRoot = join(import.meta.dirname, "..", "..", "..")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

function keysInSource(source: string): readonly string[] {
  const areas = new Set(Object.keys(catalogs.en).map((key) => key.split(".")[0]))
  const literal = new RegExp(`"((?:${[...areas].join("|")})\\.[A-Za-z0-9.]+)"`, "g")
  const direct =
    /\b(?:t|fixedUi|fixedUiBlock|fixedUiText)\(\s*["']([A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9.]+)["']/g
  const translated = /\btranslate\(\s*[^,]+,\s*["']([A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9.]+)["']/g
  return [literal, direct, translated].flatMap((pattern) =>
    [...source.matchAll(pattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]])),
  )
}

function consumedKeys(): string[] {
  const found = new Set<string>()
  for (const root of ["apps", "packages"]) {
    for (const file of sourceFiles(join(repoRoot, root))) {
      if (file.includes(join("contracts", "src", "i18n"))) continue
      for (const key of keysInSource(readFileSync(file, "utf8"))) found.add(key)
    }
  }
  return [...found]
}

const withEntry = (base: Catalog, key: string, value: string): Catalog => ({
  ...base,
  [key]: value,
})
const without = (base: Catalog, key: string): Catalog =>
  Object.fromEntries(Object.entries(base).filter(([name]) => name !== key))

describe("Given the shipped EN.json and JP.json", () => {
  it("rejects direct UI lookups even when their entire namespace is absent from both files", () => {
    const keys = keysInSource('const label = t("brandNewNamespace.missing")')
    expect(keys).toContain("brandNewNamespace.missing")
    expect(validateCatalogs(catalogs, keys)).toEqual([
      { locale: "en", key: "brandNewNamespace.missing", reason: "missing" },
      { locale: "ja", key: "brandNewNamespace.missing", reason: "missing" },
    ])
  })
  it("When validated against consumed keys Then no required key is missing or blank", () => {
    expect(validateCatalogs(catalogs, consumedKeys())).toEqual([])
  })

  it("When both files are listed Then they define the same keys", () => {
    expect(Object.keys(catalogs.ja).sort()).toEqual(Object.keys(catalogs.en).sort())
  })
})

describe("Given a consumed key", () => {
  const keys = ["interview.title", "interview.save"]

  it("When it is missing from Japanese only Then validation reports the Japanese gap", () => {
    const problems = validateCatalogs(
      { en: catalogs.en, ja: without(catalogs.ja, "interview.save") },
      keys,
    )
    expect(problems).toEqual([{ locale: "ja", key: "interview.save", reason: "missing" }])
  })

  it("When it is missing from both files Then validation fails for both, not only for a mismatch", () => {
    const problems = validateCatalogs(
      { en: without(catalogs.en, "interview.save"), ja: without(catalogs.ja, "interview.save") },
      keys,
    )
    expect(problems).toEqual([
      { locale: "en", key: "interview.save", reason: "missing" },
      { locale: "ja", key: "interview.save", reason: "missing" },
    ])
  })

  it("When the English value is whitespace only Then validation reports it as blank", () => {
    const problems = validateCatalogs(
      { en: withEntry(catalogs.en, "interview.title", "  \n"), ja: catalogs.ja },
      keys,
    )
    expect(problems).toEqual([{ locale: "en", key: "interview.title", reason: "blank" }])
  })

  it("When a consumed key is absent from the catalogs entirely Then it is reported, not ignored", () => {
    const problems = validateCatalogs(catalogs, [...keys, "interview.neverDefined"])
    expect(problems).toContainEqual({
      locale: "en",
      key: "interview.neverDefined",
      reason: "missing",
    })
  })
})

describe("Given the application sources", () => {
  it("When scanned Then the interview surface consumes catalog keys, so validation is not vacuous", () => {
    expect(consumedKeys()).toContain("interview.title")
  })
})

describe("Given runtime translation", () => {
  it("When Japanese is selected Then the Japanese phrase is returned", () => {
    expect(translate("ja", "interview.title")).toBe("読書の方向を整える")
  })

  it("When English is selected Then the English phrase is returned", () => {
    expect(translate("en", "interview.title")).toBe("Shape your reading")
  })

  it("When a Japanese value is unexpectedly unavailable Then valid English is used, never a key or blank", () => {
    const broken = { en: catalogs.en, ja: withEntry(catalogs.ja, "interview.save", " ") }
    expect(translate("ja", "interview.save", undefined, broken)).toBe("Save choices")
  })

  it("When a placeholder is interpolated Then the value is inserted as plain text", () => {
    const fixture = {
      en: { "interview.title": "Hello, {name}" },
      ja: { "interview.title": "こんにちは、{name}さん" },
    }
    expect(translate("ja", "interview.title", { name: "<b>Aya</b>" }, fixture)).toBe(
      "こんにちは、<b>Aya</b>さん",
    )
    expect(translate("en", "interview.title", { name: "Aya" }, fixture)).toBe("Hello, Aya")
  })
})
