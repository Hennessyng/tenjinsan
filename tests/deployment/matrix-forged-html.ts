import { createHash } from "node:crypto"
import { expect } from "@playwright/test"
import { z } from "zod"
import type { MatrixDeployment } from "./matrix-driver.ts"
import { recordCase } from "./matrix-evidence.ts"

type ForgedCase = {
  readonly deployment: MatrixDeployment
  readonly setupId: string
  readonly studyId: string
  readonly publicationId: string
  readonly expectedId: string
  readonly html: { readonly id: string; readonly artifactHash: string }
  readonly pdf: { readonly id: string; readonly artifactHash: string }
}

export async function runForgedHtmlCase(input: ForgedCase) {
  const { deployment, setupId, studyId, publicationId, expectedId, html, pdf } = input
  const { page, origin } = deployment
  const htmlUrl = `${origin}/publication-artifacts/${html.id}`
  const pdfUrl = `${origin}/publication-artifacts/${pdf.id}`
  const htmlDownload = await page.request.get(htmlUrl)
  const pdfDownload = await page.request.get(pdfUrl)
  expect(htmlDownload.status()).toBe(200)
  expect(pdfDownload.status()).toBe(200)
  const approvedHtml = await htmlDownload.body()
  const approvedPdf = await pdfDownload.body()
  expect(createHash("sha256").update(approvedHtml).digest("hex")).toBe(html.artifactHash)
  expect(createHash("sha256").update(approvedPdf).digest("hex")).toBe(pdf.artifactHash)
  const serialized =
    /<script type="application\/json" id="publication-data">([^<]+)<\/script>/.exec(
      approvedHtml.toString(),
    )?.[1]
  if (!serialized) throw new TypeError("Downloaded teaching state missing")
  const item = z.looseObject({ explanation: z.looseObject({ en: z.string() }) })
  const projection = z
    .looseObject({
      sections: z.array(
        z.looseObject({
          scenes: z.array(
            z.looseObject({
              layers: z.array(item).optional(),
              variants: z.array(item).optional(),
              events: z.array(item).optional(),
              steps: z.array(item).optional(),
              viewpoints: z.array(item).optional(),
            }),
          ),
        }),
      ),
    })
    .parse(JSON.parse(serialized))
  const scene = projection.sections[0]?.scenes[0]
  const state =
    scene?.layers?.[0] ??
    scene?.variants?.[0] ??
    scene?.events?.[0] ??
    scene?.steps?.[0] ??
    scene?.viewpoints?.[0]
  if (!state) throw new TypeError("Approved teaching state missing")
  state.explanation.en = "FORGED_TEACHING_STATE_NOT_APPROVED"
  const forgedJson = JSON.stringify(projection)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
  const forged = Buffer.from(approvedHtml.toString().replace(serialized, forgedJson))
  expect(createHash("sha256").update(forged).digest("hex")).not.toBe(html.artifactHash)

  const stateUrl = `${origin}/api/publications/${studyId}`
  const before = await deployment.snapshot(setupId)
  const approvedProjectionHash = before.setup?.projectionHash
  if (!approvedProjectionHash) throw new TypeError("Approved projection hash missing")
  const publicBefore = await (await page.request.get(stateUrl)).json()
  const providerCalls = await deployment.wireCount()
  const generation = `${origin}/api/publications/${studyId}/outputs/${publicationId}`
  const raw = await page.request.post(generation, {
    data: forged,
    headers: { origin, "content-type": "text/html" },
  })
  expect(raw.status()).toBe(415)
  const multipart = await page.request.post(generation, {
    multipart: { html: { name: "forged.html", mimeType: "text/html", buffer: forged } },
    headers: { origin },
  })
  expect([200, 415, 422]).toContain(multipart.status())
  const ownerForm = await page.request.post(
    `${origin}/publications/${studyId}/outputs/${publicationId}`,
    { data: forged, headers: { origin, "content-type": "text/html" } },
  )
  expect(ownerForm.status()).toBe(415)
  const decision = await page.request.post(stateUrl, {
    data: { action: "publish", expectedId, html: forged.toString() },
    headers: { origin },
  })
  expect([413, 422]).toContain(decision.status())
  const formDecision = await page.request.post(`${origin}/publications/${studyId}`, {
    form: { action: "publish", expectedId, html: forged.toString() },
    headers: { origin },
  })
  expect([405, 413, 422]).toContain(formDecision.status())
  const upload = await page.request.post(`${origin}/api/imports/upload`, {
    data: forged,
    headers: { origin, "content-type": "text/html" },
  })
  expect(upload.status()).toBe(415)
  const artifactPost = await page.request.post(pdfUrl, {
    data: forged,
    headers: { origin, "content-type": "text/html" },
  })
  expect([404, 405, 415]).toContain(artifactPost.status())
  expect(await deployment.snapshot(setupId)).toEqual(before)
  expect(await (await page.request.get(stateUrl)).json()).toEqual(publicBefore)
  expect(await deployment.wireCount()).toBe(providerCalls)
  expect(await (await page.request.get(htmlUrl)).body()).toEqual(approvedHtml)
  expect(await (await page.request.get(pdfUrl)).body()).toEqual(approvedPdf)
  return recordCase(
    deployment,
    {
      name: "forged-downloaded-html",
      http: raw.status(),
      job: "approved-pdf-unchanged",
      checks: {
        multipart: multipart.status(),
        ownerForm: ownerForm.status(),
        decision: decision.status(),
        formDecision: formDecision.status(),
        upload: upload.status(),
        artifactPost: artifactPost.status(),
        forgedHtmlHash: createHash("sha256").update(forged).digest("hex"),
        approvedProjectionHash,
        approvedHtmlHash: html.artifactHash,
        approvedPdfHash: pdf.artifactHash,
        projectionAndArtifactsUnchanged: true,
      },
    },
    setupId,
  )
}
