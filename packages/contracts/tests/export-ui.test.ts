import { describe, expect, it } from "vitest"
import { DEFAULT_EXPORT_UI, ExportUi, PublicationOutput } from "../src/index.ts"

const queued = {
  id: "job-1",
  publicationId: "publication-1",
  format: "html",
  state: "queued",
  expiresAt: null,
  error: null,
  artifact: null,
}

describe("Given an export UI choice", () => {
  it.each(["en", "ja", "en+ja"])("When %s is chosen Then it is accepted unchanged", (choice) => {
    expect(ExportUi.parse(choice)).toBe(choice)
  })

  it.each(["fr", "", "EN", "ja+en", "en+ja ", "both", null, undefined])(
    "When %j is chosen Then it is rejected",
    (choice) => {
      expect(ExportUi.safeParse(choice).success).toBe(false)
    },
  )

  it("When no choice is made Then the default is English", () => {
    expect(DEFAULT_EXPORT_UI).toBe("en")
  })
})

describe("Given a queued output record", () => {
  it.each(["en", "ja", "en+ja"])("When it carries %s Then the choice is kept", (exportUi) => {
    expect(PublicationOutput.parse({ ...queued, exportUi }).exportUi).toBe(exportUi)
  })

  it("When it predates the choice Then it parses with the choice absent, not defaulted", () => {
    const legacy = PublicationOutput.parse(queued)
    expect(legacy.exportUi).toBeUndefined()
    expect("exportUi" in legacy).toBe(false)
  })

  it("When the choice is unsupported Then the record is rejected", () => {
    expect(PublicationOutput.safeParse({ ...queued, exportUi: "fr" }).success).toBe(false)
  })

  it("When the record is running Then the choice survives the state change", () => {
    const running = PublicationOutput.parse({
      ...queued,
      exportUi: "ja",
      state: "running",
      expiresAt: new Date().toISOString(),
    })
    expect(running.exportUi).toBe("ja")
  })
})
