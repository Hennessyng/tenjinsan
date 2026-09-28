import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { basename } from "node:path"
import { promisify } from "node:util"
import { expect } from "@playwright/test"
import type { readTask31Records } from "@reading-studio/server/task31-records"
import { z } from "zod"
import type { runDeployedJourney } from "./deployed-journey.ts"

const exec = promisify(execFile)

export async function verifyDeployedEvidence(
  journey: Awaited<ReturnType<typeof runDeployedJourney>>,
  records: ReturnType<typeof readTask31Records>,
  mode: "local" | "compose",
): Promise<void> {
  const { original, fork } = records
  expect(original.studyId).toBe(journey.studyId)
  expect(fork.studyId).toBe(journey.forkId)
  expect(original.parent).toBeNull()
  expect(fork.parent).toEqual({ studyId: original.studyId, setupRevisionId: original.setupId })
  expect(fork.ownerId).toBe(original.ownerId)
  expect(fork.editionId).toBe(original.editionId)
  expect(fork.setupId).not.toBe(original.setupId)
  expect(fork.analysisId).toBe(original.analysisId)
  expect(fork.briefId).not.toBe(original.briefId)
  expect(fork.outlineId).not.toBe(original.outlineId)
  expect(original.outlineId).toBe(journey.outlineId)
  expect(fork.outlineId).toBe(journey.forkOutlineId)
  expect(original.lessonId).toBe(journey.lessonId)
  expect(fork.lessonId).not.toBe(original.lessonId)
  expect(original.grantId).toBe(`grant-${original.setupId}`)
  for (const study of [original, fork]) {
    expect(study.currentPublication).toBe(true)
    expect(study.publication.lessonId).toBe(study.lessonId)
    expect(study.publication.evidenceReportHash).toBe(study.publication.reviewedReportHash)
    expect(study.outputs).toHaveLength(2)
    expect(study.outputs.map((output) => output.format).toSorted()).toEqual(["html", "pdf"])
  }
  expect(fork.publication.id).not.toBe(original.publication.id)
  expect(journey.downloads).toHaveLength(4)

  const artifacts = []
  for (const study of [original, fork]) {
    const title =
      study.studyId === original.studyId
        ? "How can asking change listening?"
        : "How can listening support a shared decision?"
    for (const output of study.outputs) {
      expect(output.state).toBe("released")
      expect(output.publicationId).toBe(study.publication.id)
      expect(output.artifactPublicationId).toBe(study.publication.id)
      const download = journey.downloads.find((item) => item.jobId === output.jobId)
      if (!download) throw new TypeError(`Missing downloaded artifact ${output.jobId}`)
      expect(download.format).toBe(output.format)
      expect(download.suggestedFilename).toContain(study.publication.id)
      expect(download.suggestedFilename).toContain(`.${output.format}`)
      const bytes = await readFile(download.path)
      const actualSha256 = createHash("sha256").update(bytes).digest("hex")
      expect(actualSha256).toBe(download.sha256)
      expect(actualSha256).toBe(output.artifactSha256)
      expect(actualSha256).toBe(output.storedSha256)
      expect(bytes.length).toBe(download.bytes)
      expect(bytes.length).toBe(output.storedBytes)
      if (output.format === "pdf") {
        expect(bytes.toString("latin1", 0, 8)).toContain("%PDF-")
        const [{ stdout: info }, { stdout: text }] = await Promise.all([
          exec("pdfinfo", [download.path]),
          exec("pdftotext", [download.path, "-"]),
        ])
        const pages = Number(info.match(/^Pages:\s*(\d+)/m)?.[1])
        expect(Number.isInteger(pages) && pages > 0).toBe(true)
        expect(text).toContain(title)
        artifacts.push({
          studyId: study.studyId,
          ...output,
          download: basename(download.path),
          suggestedFilename: download.suggestedFilename,
          actualSha256,
          bytes: bytes.length,
          pages,
          extractedTextCheck: { contains: title, matched: true },
        })
      } else {
        const html = bytes.toString("utf8")
        expect(html.slice(0, 20).toLowerCase()).toContain("<!doctype")
        expect(html).toContain(title)
        artifacts.push({
          studyId: study.studyId,
          ...output,
          download: basename(download.path),
          suggestedFilename: download.suggestedFilename,
          actualSha256,
          bytes: bytes.length,
          htmlTextCheck: { contains: title, matched: true },
        })
      }
    }
  }
  await writeFile(
    journey.manifestPath,
    `${JSON.stringify(
      {
        runId: journey.runId,
        mode,
        capturedAt: new Date().toISOString(),
        original,
        fork,
        artifacts,
        offlineAfterStop: "offline-after-stop.png",
      },
      null,
      2,
    )}\n`,
  )
}

export async function assertSavedManifest(
  journey: Awaited<ReturnType<typeof runDeployedJourney>>,
  records: ReturnType<typeof readTask31Records>,
  mode: "local" | "compose",
): Promise<void> {
  const manifest = z
    .object({
      runId: z.string().uuid(),
      mode: z.enum(["local", "compose"]),
      original: z.object({
        studyId: z.string(),
        publication: z.object({ id: z.string(), lessonId: z.string() }),
      }),
      fork: z.object({
        studyId: z.string(),
        parent: z.object({ studyId: z.string(), setupRevisionId: z.string() }),
        publication: z.object({ id: z.string(), lessonId: z.string() }),
      }),
      artifacts: z
        .array(
          z.object({
            studyId: z.string(),
            publicationId: z.string(),
            jobId: z.string(),
            format: z.enum(["html", "pdf"]),
            download: z.string(),
            actualSha256: z.string(),
            artifactSha256: z.string(),
            pages: z.number().int().positive().optional(),
            extractedTextCheck: z.object({ matched: z.literal(true) }).optional(),
          }),
        )
        .length(4),
    })
    .parse(JSON.parse(await readFile(journey.manifestPath, "utf8")))
  expect(manifest.runId).toBe(journey.runId)
  expect(manifest.mode).toBe(mode)
  expect(manifest.original.studyId).toBe(journey.studyId)
  expect(manifest.original.publication).toEqual({
    id: records.original.publication.id,
    lessonId: journey.lessonId,
  })
  expect(manifest.fork.parent).toEqual({
    studyId: journey.studyId,
    setupRevisionId: records.original.setupId,
  })
  expect(manifest.fork.publication).toEqual({
    id: records.fork.publication.id,
    lessonId: records.fork.lessonId,
  })
  for (const artifact of manifest.artifacts) {
    const download = journey.downloads.find((item) => item.jobId === artifact.jobId)
    if (!download) throw new TypeError("Manifest references a missing download")
    expect(artifact.download).toBe(basename(download.path))
    const bytes = await readFile(download.path)
    expect(artifact.actualSha256).toBe(createHash("sha256").update(bytes).digest("hex"))
    expect(artifact.artifactSha256).toBe(artifact.actualSha256)
    if (artifact.format === "pdf") {
      expect(artifact.pages).toBeGreaterThan(0)
      expect(artifact.extractedTextCheck?.matched).toBe(true)
    }
  }
}
