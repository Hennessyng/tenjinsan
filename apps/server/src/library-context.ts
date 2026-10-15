import { StudyId } from "@reading-studio/contracts"
import type { SourceRepository } from "@reading-studio/storage"
import type { Hono } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { z } from "zod"
import type { AppEnvironment } from "./middleware/access.ts"

const Selection = z.strictObject({ studyId: StudyId })
const selectionCookie = "tj_study"

export function configureLibraryContext(
  app: Hono<AppEnvironment>,
  sources: SourceRepository,
  secure: boolean,
): void {
  const cookieOptions = { path: "/", httpOnly: true, sameSite: "Strict", secure } as const
  app.get("/api/library-context", (context) => {
    const ownerId = context.get("ownerId")
    const documents = sources.listDocuments(ownerId)
    const editions = new Map(documents.map(({ edition }) => [edition.id, edition]))
    const studies = [...editions.values()].flatMap((edition) =>
      sources
        .listStudiesByEdition(edition.id)
        .filter((study) => study.ownerId === ownerId)
        .map((study) => {
          const setup = sources.getLatestSetup(study.id)
          const normalizations = documents
            .filter((document) => document.edition.id === edition.id)
            .map((document) => document.normalization.id)
          return {
            id: study.id,
            editionId: edition.id,
            title: edition.title,
            normalizationId:
              setup?.analysis.normalizationRevisionId ??
              (normalizations.length === 1 ? normalizations[0] : null),
            normalizations,
            setupId: setup?.id ?? null,
          }
        }),
    )
    const preference = getCookie(context, selectionCookie)
    const valid = StudyId.safeParse(preference)
    const selected = valid.success ? studies.find((study) => study.id === valid.data) : undefined
    if (preference !== undefined && !selected) deleteCookie(context, selectionCookie, cookieOptions)
    context.header("Cache-Control", "private, no-store")
    return context.json({ studies, selectedStudyId: selected?.id ?? null })
  })
  app.post("/api/library-selection", async (context) => {
    const parsed = Selection.safeParse(await context.req.json())
    if (!parsed.success) return context.json({ error: "Invalid study selection" }, 400)
    const ownerId = context.get("ownerId")
    const owned = sources
      .listDocuments(ownerId)
      .some(({ edition }) =>
        sources
          .listStudiesByEdition(edition.id)
          .some((study) => study.ownerId === ownerId && study.id === parsed.data.studyId),
      )
    if (!owned) return context.json({ error: "Study not found" }, 404)
    setCookie(context, selectionCookie, parsed.data.studyId, cookieOptions)
    context.header("Cache-Control", "private, no-store")
    return context.json({ selectedStudyId: parsed.data.studyId })
  })
}
