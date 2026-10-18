import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PublicationSnapshot } from "@reading-studio/contracts"
import { publicationFixture } from "@reading-studio/server/publication-fixture"
import { ContractBoundaryError, openStorage } from "@reading-studio/storage"
import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import { approvePublication } from "./publication-service.ts"

let fixture: Awaited<ReturnType<typeof publicationFixture>> | undefined
afterEach(async () => {
  await fixture?.close()
})

describe("Given Publish with an export UI choice", () => {
  it.each(["en", "ja", "en+ja"] as const)(
    "When %s is chosen Then both queued jobs are fixed to it",
    async (choice) => {
      fixture = await publicationFixture()
      const snapshot = approvePublication(fixture.storage, fixture.view, choice)
      expect(snapshot).toMatchObject({ exportUi: choice })
      const outputs = fixture.storage.publicationOutputs.outputs(snapshot.publication.id)
      expect(outputs.map((job) => [job.format, job.state, job.exportUi])).toEqual([
        ["html", "queued", choice],
        ["pdf", "queued", choice],
      ])
    },
  )

  it("When no choice is made Then both jobs are English regardless of anything else", async () => {
    fixture = await publicationFixture()
    const snapshot = approvePublication(fixture.storage, fixture.view)
    const outputs = fixture.storage.publicationOutputs.outputs(snapshot.publication.id)
    expect(outputs.map((job) => job.exportUi)).toEqual(["en", "en"])
  })

  it("When the choice is unsupported Then Publish is rejected and nothing is queued", async () => {
    fixture = await publicationFixture()
    const { storage, view } = fixture
    expect(() => approvePublication(storage, view, "fr")).toThrow()
    expect(storage.publicationOutputs.list(view.draft.studyId)).toEqual([])
  })

  it("When Publish is repeated with another choice Then the first fixed choice stands", async () => {
    fixture = await publicationFixture()
    const first = approvePublication(fixture.storage, fixture.view, "ja")
    const again = approvePublication(fixture.storage, fixture.view, "en+ja")
    expect(again.publication.id).toBe(first.publication.id)
    expect(
      fixture.storage.publicationOutputs.outputs(first.publication.id).map((job) => job.exportUi),
    ).toEqual(["ja", "ja"])
  })
})

describe("Given a queued job with a fixed choice", () => {
  it("When it is claimed or fails Then the choice is unchanged", async () => {
    fixture = await publicationFixture()
    const snapshot = approvePublication(fixture.storage, fixture.view, "en+ja")
    const [html, pdf] = fixture.storage.publicationOutputs.outputs(snapshot.publication.id)
    if (!html || !pdf) throw new TypeError("Missing queued jobs")
    expect(fixture.storage.publicationOutputs.claim(html.id).exportUi).toBe("en+ja")
    fixture.storage.publicationOutputs.fail(pdf.id, "render-error")
    expect(fixture.storage.publicationOutputs.output(html.id)?.exportUi).toBe("en+ja")
    expect(fixture.storage.publicationOutputs.output(pdf.id)).toMatchObject({
      state: "failed",
      exportUi: "en+ja",
    })
  })

  it("When its storage is closed and reopened by a separate owner Then the fixed choice is read back", async () => {
    fixture = await publicationFixture()
    const snapshot = approvePublication(fixture.storage, fixture.view, "ja")
    const source = new Database(fixture.databasePath)
    source.pragma("wal_checkpoint(TRUNCATE)")
    source.close()
    const directory = await mkdtemp(join(tmpdir(), "publication-reopen-"))
    try {
      const databasePath = join(directory, "reopened.sqlite")
      const privateDataRoot = join(directory, "private")
      await copyFile(fixture.databasePath, databasePath)
      openStorage({ databasePath, privateDataRoot }).close()
      const reopened = openStorage({ databasePath, privateDataRoot })
      try {
        expect(reopened.publicationOutputs.get(snapshot.publication.id)).toMatchObject({
          exportUi: "ja",
        })
        expect(
          reopened.publicationOutputs
            .outputs(snapshot.publication.id)
            .map((job) => [job.format, job.exportUi]),
        ).toEqual([
          ["html", "ja"],
          ["pdf", "ja"],
        ])
      } finally {
        reopened.close()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("When snapshot language is updated directly Then the immutable snapshot trigger rejects it", async () => {
    fixture = await publicationFixture()
    const snapshot = approvePublication(fixture.storage, fixture.view, "ja")
    expect(snapshot).toMatchObject({ exportUi: "ja" })
    const writer = new Database(fixture.databasePath)
    try {
      writer.pragma("recursive_triggers = ON")
      expect(() =>
        writer
          .prepare("UPDATE publication_snapshots SET record_json = ? WHERE publication_id = ?")
          .run(JSON.stringify({ ...snapshot, exportUi: "en" }), snapshot.publication.id),
      ).toThrow(/immutable snapshot/)
    } finally {
      writer.close()
    }
  })

  it("When queued job metadata disagrees with its captured snapshot Then claim is rejected", async () => {
    fixture = await publicationFixture()
    const { storage, databasePath } = fixture
    const snapshot = approvePublication(storage, fixture.view, "ja")
    const [output] = storage.publicationOutputs.outputs(snapshot.publication.id)
    if (!output) throw new TypeError("Missing queued output")
    const writer = new Database(databasePath)
    try {
      writer
        .prepare("UPDATE publication_outputs SET record_json = ? WHERE id = ?")
        .run(JSON.stringify({ ...output, exportUi: "en" }), output.id)
    } finally {
      writer.close()
    }
    expect(() => storage.publicationOutputs.claim(output.id)).toThrow(ContractBoundaryError)
  })

  it("When a job predates the choice Then it reads without one and is not defaulted", async () => {
    fixture = await publicationFixture()
    const snapshot = approvePublication(fixture.storage, fixture.view, "ja")
    const [html] = fixture.storage.publicationOutputs.outputs(snapshot.publication.id)
    if (!html) throw new TypeError("Missing queued job")
    const { exportUi: _removed, ...legacy } = html
    const writer = new Database(fixture.databasePath)
    try {
      writer.pragma("recursive_triggers = ON")
      writer
        .prepare("UPDATE publication_outputs SET record_json = ? WHERE id = ?")
        .run(JSON.stringify(legacy), html.id)
    } finally {
      writer.close()
    }
    expect(fixture.storage.publicationOutputs.output(html.id)?.exportUi).toBeUndefined()
    const legacySnapshot = PublicationSnapshot.parse({
      publication: snapshot.publication,
      evidence: snapshot.evidence,
    })
    expect(legacySnapshot.exportUi).toBeUndefined()
    expect("exportUi" in legacySnapshot).toBe(false)
    const { storage } = fixture
    expect(() => storage.publicationOutputs.claim(html.id)).toThrow(ContractBoundaryError)
  })
})
