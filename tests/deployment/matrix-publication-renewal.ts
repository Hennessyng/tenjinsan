import { type APIResponse, expect } from "@playwright/test"
import { z } from "zod"
import type { MatrixDeployment } from "./matrix-driver.ts"
import { runForgedHtmlCase } from "./matrix-forged-html.ts"
import { until } from "./matrix-provider-failures.ts"

export async function runRenewedPublication(input: {
  readonly deployment: MatrixDeployment
  readonly post: (path: string, data: object) => Promise<APIResponse>
  readonly setupId: string
  readonly studyId: string
  readonly evidenceUrl: string
  readonly approvedId: string
  readonly previousPublicationId: string
}) {
  const { deployment, post, setupId, studyId, evidenceUrl, approvedId, previousPublicationId } =
    input
  const { page, origin } = deployment
  await deployment.renderFailure(false)
  const revised = await post(`/api/publications/${studyId}`, {
    expectedId: approvedId,
    action: "revise",
  })
  expect(revised.status()).toBe(200)
  for (const category of ["support", "qualification", "translation", "visual"] as const) {
    const latest = z
      .object({ view: z.object({ draft: z.object({ id: z.string() }) }) })
      .parse(await (await page.request.get(`${origin}${evidenceUrl}`)).json()).view.draft.id
    expect(
      (
        await post(evidenceUrl, {
          expectedId: latest,
          action: "semantic",
          category,
          status: "reviewed",
        })
      ).status(),
    ).toBe(200)
  }
  const latest = z
    .object({ view: z.object({ draft: z.object({ id: z.string() }) }) })
    .parse(await (await page.request.get(`${origin}${evidenceUrl}`)).json()).view.draft.id
  expect(
    (await post(evidenceUrl, { expectedId: latest, action: "privacy-reviewed" })).status(),
  ).toBe(200)
  const currentId = z
    .object({ view: z.object({ draft: z.object({ id: z.string() }), ready: z.literal(true) }) })
    .parse(await (await page.request.get(`${origin}${evidenceUrl}`)).json()).view.draft.id
  expect(
    (
      await post(`/api/publications/${studyId}`, { expectedId: currentId, action: "publish" })
    ).status(),
  ).toBe(200)
  const publicationId = (await deployment.snapshot(setupId)).setup?.publicationId
  if (!publicationId || publicationId === previousPublicationId)
    throw new TypeError("Renewed publication missing")
  expect((await post(`/api/publications/${studyId}/outputs/${publicationId}`, {})).status()).toBe(
    200,
  )
  const approved = await until(async () => {
    const records = (await deployment.snapshot(setupId)).setup?.outputs
    return records?.length === 2 && records.every((output) => output.state === "released")
      ? records
      : null
  }, "approved HTML and PDF")
  const html = approved.find((output) => output.format === "html")
  const pdf = approved.find((output) => output.format === "pdf")
  if (!html?.artifactHash || !pdf?.artifactHash) throw new TypeError("Approved artifacts missing")
  return runForgedHtmlCase({
    deployment,
    setupId,
    studyId,
    publicationId,
    expectedId: currentId,
    html: { id: html.id, artifactHash: html.artifactHash },
    pdf: { id: pdf.id, artifactHash: pdf.artifactHash },
  })
}
