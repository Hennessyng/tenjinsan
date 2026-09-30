import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { analysisCacheKey, contentDigest } from "@reading-studio/contracts"
import { epubEntries, zipFixture } from "@reading-studio/ingestion/test-support"
import { openStorage } from "@reading-studio/storage"
import { z } from "zod"
import { LocalLauncher, makeLocalFixture, removeLocalFixture } from "./local-fixture.ts"
import { startProductionWire } from "./production-wire.ts"

const hosted = process.env["STUDIO_COMPOSE_TEST_MODE"] === "enabled"
const wire = hosted ? null : await startProductionWire()
const fixture = hosted ? null : await makeLocalFixture(true)
const environment = { ...(fixture?.environment ?? process.env) }
delete environment["STUDIO_SYNTHETIC_TEST_MODE"]
const launcher =
  fixture && wire
    ? new LocalLauncher({
        ...environment,
        OPENROUTER_API_KEY: "wire-only-test-credential",
        ANTHROPIC_API_KEY: "",
        STUDIO_PROVIDER_BASE_URL: wire.baseURL,
      })
    : null
const wireCount = () =>
  wire?.requests.length ?? Number(readFileSync("/data/production-wire-count", "utf8"))
const wireMetrics = () =>
  wire?.metrics ??
  z
    .array(z.object({ bodyBytes: z.number(), sectionId: z.string().nullable() }))
    .parse(JSON.parse(readFileSync("/data/production-wire-metrics", "utf8")))

async function waitFor<T>(read: () => T | null, label: string): Promise<T> {
  const deadline = Date.now() + 15_000
  let value = read()
  while (value === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    value = read()
  }
  if (value === null) throw new TypeError(`${label} did not persist`)
  return value
}

try {
  const ready = launcher
    ? await launcher.ready()
    : { apiUrl: "http://127.0.0.1:8787", launcherPid: 0 }
  const origin = hosted ? "https://localhost" : ready.apiUrl
  const forwarded = hosted ? { "x-forwarded-host": "localhost" } : {}
  const login = await fetch(`${ready.apiUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { origin, ...forwarded },
    body: new URLSearchParams({
      email: "owner@example.test",
      password: "correct horse battery staple",
    }),
  })
  const cookie = login.headers
    .getSetCookie()
    .map((entry) => entry.split(";", 1)[0])
    .join("; ")
  if (login.status !== 303 || !cookie) throw new TypeError("Manual QA owner login failed")
  const post = (path: string, fields: Record<string, string>): Promise<Response> =>
    fetch(`${ready.apiUrl}${path}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        origin,
        ...forwarded,
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify(fields),
    })

  const upload = await fetch(`${ready.apiUrl}/api/imports/upload`, {
    method: "POST",
    headers: { origin, ...forwarded, cookie, "content-type": "application/epub+zip" },
    body: zipFixture(epubEntries),
  })
  if (upload.status !== 202) throw new TypeError(`Intake HTTP ${upload.status}`)
  const receipt = z.object({ sha256: z.string().length(64) }).parse(await upload.json())
  const revision = `normalization-${createHash("sha256")
    .update(JSON.stringify([receipt.sha256, "epub-parser-1", "epub-normalizer-1"]))
    .digest("hex")}`
  const draft = await post(`/api/study-setup/${revision}`, {
    provider: "openrouter",
    model: "gpt-4.1-mini",
    scope: "all-main-chapters",
  })
  if (draft.status !== 201) throw new TypeError(`Setup HTTP ${draft.status}`)
  if (wireCount() !== 0) throw new TypeError("Provider called before explicit grant")
  const setupId = z.object({ setupId: z.string() }).parse(await draft.json()).setupId
  const send = await post(`/api/study-setup/${revision}/${setupId}`, { decision: "send" })
  if (send.status !== 200) throw new TypeError(`Grant HTTP ${send.status}`)

  const storage = openStorage({
    databasePath: z.string().parse(environment["DATABASE_PATH"]),
    privateDataRoot: z.string().parse(environment["PRIVATE_DATA_ROOT"]),
  })
  try {
    const setup = storage.sources.getSetup(setupId)
    if (!setup) throw new TypeError("Missing persisted setup")
    const analysis = await waitFor(
      () => storage.workflow.findSuccessfulAnalysis(analysisCacheKey(setup.analysis)),
      "Analysis",
    )
    const study = storage.sources
      .listStudiesByEdition(setup.editionId)
      .find((item) => item.id === setup.studyId)
    if (!study) throw new TypeError("Missing persisted study")
    const interview = await waitFor(() => storage.interviews.latest(study.id), "Interview")
    const question = interview.steps[0]?.question
    if (!question || question.options.length < 2)
      throw new TypeError("Selectable questions missing")
    const choice = await post(`/api/interviews/${study.id}`, {
      interviewId: interview.id,
      questionId: question.id,
      questionRevisionId: question.revisionId,
      kind: "choice",
      optionIds: question.options[0]?.id ?? "",
    })
    if (choice.status !== 200) throw new TypeError(`Answer HTTP ${choice.status}`)
    const custom = await post(`/api/interviews/${study.id}`, {
      interviewId: interview.id,
      questionId: question.id,
      questionRevisionId: question.revisionId,
      kind: "custom",
      text: "How can attention make room for uncertainty?",
    })
    if (
      custom.status !== 200 ||
      storage.interviews.answers(interview.id)[0]?.answer.kind !== "custom"
    )
      throw new TypeError(`Custom question HTTP ${custom.status}`)

    const saveBrief = await post(`/api/briefs/${study.id}`, {
      action: "save",
      expectedRevisionId: "",
      originalEn: "How does attention shape listening?",
      originalJa: "注意は聴くことをどう変えますか？",
      refinedEn: "",
      refinedJa: "",
      supportEn0: "",
      supportJa0: "",
      supportEn1: "",
      supportJa1: "",
      supportEn2: "",
      supportJa2: "",
      purpose: "Read this source carefully",
      context: "Synthetic QA context",
      questionChoice: "original",
      depth: "focused",
      language: "paired",
      spoilerPolicy: "avoid",
      exclusions: "",
    })
    if (saveBrief.status !== 200) throw new TypeError(`Brief save HTTP ${saveBrief.status}`)
    const briefId = storage.briefs.current(study.id)?.draft.id
    if (!briefId) throw new TypeError("Missing draft brief")
    const approveBrief = await post(`/api/briefs/${study.id}`, {
      revisionId: briefId,
      action: "approve",
    })
    if (approveBrief.status !== 200)
      throw new TypeError(`Brief approval HTTP ${approveBrief.status}`)
    const generateOutline = await post(`/api/outlines/${study.id}`, {
      action: "generate",
      briefRevisionId: briefId,
      expectedRevisionId: "",
    })
    if (generateOutline.status !== 200)
      throw new TypeError(`Outline enqueue HTTP ${generateOutline.status}`)
    const initialOutline = await waitFor(() => storage.outlines.current(study.id), "Outline")
    const outlineChoice = await post(`/api/outlines/${study.id}`, {
      action: "choice",
      revisionId: initialOutline.draft.id,
      value: "simplify-visuals",
    })
    if (outlineChoice.status !== 200)
      throw new TypeError(`Outline choice HTTP ${outlineChoice.status}`)
    const choiceRequestId = z
      .object({ view: z.object({ draft: z.object({ id: z.string() }) }) })
      .parse(await outlineChoice.json()).view.draft.id
    const chosen = await waitFor(() => {
      const view = storage.outlines.current(study.id)
      return view?.draft.id !== choiceRequestId &&
        view?.draft.feedback?.kind === "choice" &&
        storage.execution.getJob(`outline-${choiceRequestId}`)?.state === "completed"
        ? view
        : null
    }, "Outline choice revision")
    const outlineCustom = await post(`/api/outlines/${study.id}`, {
      action: "custom",
      revisionId: chosen.draft.id,
      text: "Show the cited limitation before the example",
    })
    if (outlineCustom.status !== 200)
      throw new TypeError(`Outline custom HTTP ${outlineCustom.status}`)
    const customRequestId = z
      .object({ view: z.object({ draft: z.object({ id: z.string() }) }) })
      .parse(await outlineCustom.json()).view.draft.id
    const outline = await waitFor(() => {
      const view = storage.outlines.current(study.id)
      return view?.draft.id !== customRequestId &&
        view?.draft.feedback?.kind === "custom" &&
        storage.execution.getJob(`outline-${customRequestId}`)?.state === "completed"
        ? view
        : null
    }, "Outline custom revision")
    if (
      outline.draft.content.sections[0]?.visualIntents[0]?.en !==
      "Show the cited limitation before the example"
    )
      throw new TypeError("Provider did not apply approved outline feedback")
    const approveOutline = await post(`/api/outlines/${study.id}`, {
      revisionId: outline.draft.id,
      action: "approve",
    })
    if (approveOutline.status !== 200)
      throw new TypeError(`Outline approval HTTP ${approveOutline.status}`)
    const lessonJobId = `lesson-${contentDigest(JSON.stringify([outline.draft.id, setup.id, `grant-${setup.id}`]))}`
    const lesson = await waitFor(
      () => storage.workflow.getLesson(`lesson-${lessonJobId}`),
      "Lesson",
    )

    const evidenceUrl = `${ready.apiUrl}/api/evidence/${study.id}/${lesson.id}`
    const evidencePage = await fetch(evidenceUrl, { headers: { cookie, ...forwarded } })
    if (evidencePage.status !== 200) throw new TypeError(`Evidence HTTP ${evidencePage.status}`)
    for (const category of ["support", "qualification", "translation", "visual"]) {
      const review = storage.reviews.current(lesson.id)
      if (!review) throw new TypeError("Missing current evidence draft")
      const reviewed = await post(`/api/evidence/${study.id}/${lesson.id}`, {
        expectedId: review.id,
        action: "semantic",
        category,
        status: "reviewed",
      })
      if (reviewed.status !== 200)
        throw new TypeError(`Evidence ${category} HTTP ${reviewed.status}`)
    }
    const review = storage.reviews.current(lesson.id)
    if (!review) throw new TypeError("Missing reviewed evidence draft")
    const privacy = await post(`/api/evidence/${study.id}/${lesson.id}`, {
      expectedId: review.id,
      action: "privacy-reviewed",
    })
    if (privacy.status !== 200) throw new TypeError(`Privacy review HTTP ${privacy.status}`)
    const approvedReview = storage.reviews.current(lesson.id)
    if (!approvedReview) throw new TypeError("Missing privacy-reviewed draft")
    const publish = await post(`/api/publications/${study.id}`, {
      expectedId: approvedReview.id,
      action: "publish",
    })
    if (publish.status !== 200) throw new TypeError(`Publication HTTP ${publish.status}`)
    const publication = storage.publicationOutputs.list(study.id)[0]
    if (!publication) throw new TypeError("Missing approved publication")
    const generate = await post(
      `/api/publications/${study.id}/outputs/${publication.publication.id}`,
      {},
    )
    if (generate.status !== 200) throw new TypeError(`Output generation HTTP ${generate.status}`)
    const outputs = storage.publicationOutputs.outputs(publication.publication.id)
    const artifactBytes = { html: 0, pdf: 0 }
    const artifactHashes = { html: "", pdf: "" }
    for (const format of ["html", "pdf"] as const) {
      const pending = outputs.find((item) => item.format === format)
      if (!pending) throw new TypeError(`${format} output not queued`)
      const output = await waitFor(() => {
        const current = storage.publicationOutputs.output(pending.id)
        if (current?.state === "failed")
          throw new TypeError(`${format} output failed: ${current.error}`)
        return current?.state === "released" ? current : null
      }, `${format} worker output`)
      const download = await fetch(`${ready.apiUrl}/publication-artifacts/${output.id}`, {
        headers: { cookie, ...forwarded },
      })
      const bytes = new Uint8Array(await download.arrayBuffer())
      if (download.status !== 200 || bytes.length === 0)
        throw new TypeError(`${format} download failed`)
      artifactBytes[format] = bytes.length
      artifactHashes[format] = createHash("sha256").update(bytes).digest("hex")
      if (artifactHashes[format] !== output.artifact.contentHash)
        throw new TypeError(`${format} download differs from persisted publication`)
      if (format === "pdf" && new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
        throw new TypeError("PDF signature missing")
      if (format === "html" && !new TextDecoder().decode(bytes).includes('lang="ja"'))
        throw new TypeError("Bilingual HTML content missing")
    }
    const grantId = `grant-${setup.id}`
    const questionsJobId = `questions-${contentDigest(JSON.stringify([setup.id, grantId, analysis.id]))}`
    const outlineJobId = `outline-${contentDigest(JSON.stringify([briefId, setup.id, grantId]))}`
    const stageJobs = [
      ...storage.execution
        .listCompletedAnalysisJobs()
        .filter((job) => job.setupRevisionId === setup.id),
      storage.execution.getJob(questionsJobId),
      storage.execution.getJob(outlineJobId),
      storage.execution.getJob(`outline-${choiceRequestId}`),
      storage.execution.getJob(`outline-${customRequestId}`),
      storage.execution.getJob(lessonJobId),
    ]
    if (
      stageJobs.some((job) => job?.state !== "completed") ||
      stageJobs.reduce(
        (count, job) => count + (job ? storage.execution.listAttempts(job.runId).length : 0),
        0,
      ) !== wireCount()
    )
      throw new TypeError("Provider dispatches differ from completed persisted attempts")
    const metrics = wireMetrics()
    if (metrics.some((metric) => metric.bodyBytes > 32_000))
      throw new TypeError("Provider request exceeded measured bound")
    const sectionOrder = metrics.flatMap((metric) => (metric.sectionId ? [metric.sectionId] : []))
    if (
      JSON.stringify(sectionOrder) !==
      JSON.stringify(outline.draft.content.sections.map((section) => section.id))
    )
      throw new TypeError("Lesson section dispatch order differs from approved outline")
    if (
      stageJobs.some(
        (job) =>
          job?.grant.id !== grantId ||
          job.setupRevisionId !== setup.id ||
          job.provider !== setup.analysis.provider ||
          job.model !== setup.analysis.model,
      )
    )
      throw new TypeError("Provider job switched consent or model")
    if (
      lesson.setupRevisionId !== setup.id ||
      lesson.analysisRevisionId !== analysis.id ||
      lesson.briefRevisionId !== briefId ||
      lesson.outlineRevisionId !== outline.draft.id ||
      publication.publication.lessonRevisionId !== lesson.id ||
      publication.publication.approval.evidenceReportHash !== publication.evidence.reportHash
    )
      throw new TypeError("Approved source-to-publication lineage differs")
    process.stdout.write(
      `${JSON.stringify({
        mode: "normal",
        intake: upload.status,
        grant: send.status,
        analysis: analysis.status,
        edition: storage.counts().editions,
        questionOptions: question.options.length,
        customAnswer: storage.interviews.answers(interview.id)[0]?.answer.kind,
        brief: storage.briefs.current(study.id)?.status,
        outline: storage.outlines.current(study.id)?.status,
        lesson: lesson.id,
        publication: publication.publication.id,
        artifactBytes,
        artifactHashes,
        providerWireCalls: wireCount(),
        providerRequestBytes: metrics.map((metric) => metric.bodyBytes),
        lessonSectionOrder: sectionOrder,
        jobs: storage.counts().jobs,
      })}\n`,
    )
  } finally {
    storage.close()
  }
  if (launcher) await launcher.stop(ready.launcherPid)
} finally {
  launcher?.forceStop()
  await wire?.close()
  if (fixture) await removeLocalFixture(fixture)
}
