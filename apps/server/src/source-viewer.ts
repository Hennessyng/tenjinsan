import { Digest, NormalizationRevisionId } from "@reading-studio/contracts"
import type { SourceRepository } from "@reading-studio/storage"
import { missingSource, sourcePage, sourceReader } from "@reading-studio/studio/source-viewer"
import type { Hono } from "hono"
import { html } from "hono/html"
import { z } from "zod"
import type { AppEnvironment } from "./middleware/access.ts"
import { queuedImports } from "./source-import-status.ts"

const Query = z
  .strictObject({
    chapter: z
      .string()
      .regex(/^(0|[1-9]\d*)$/)
      .transform(Number)
      .pipe(z.number().int().safe())
      .optional(),
    citation: Digest.optional(),
  })
  .refine((value) => value.chapter === undefined || value.citation === undefined)

export function configureSourceViewer(
  app: Hono<AppEnvironment>,
  sources: SourceRepository,
  importRoot?: string,
) {
  app.get("/api/source-library", async (context) => {
    const documents = sources.listDocuments(context.get("ownerId"))
    const pending = (await queuedImports(importRoot, context.get("ownerId"))).filter(
      (receipt) => !documents.some(({ edition }) => edition.originalHash === receipt.sha256),
    )
    context.header("Cache-Control", "private, no-store")
    return context.json({ documents, pending: pending.map(({ id, bytes }) => ({ id, bytes })) })
  })
  app.get("/api/source-reader/:revision", (context) => {
    context.header("Cache-Control", "private, no-store")
    const revision = NormalizationRevisionId.safeParse(context.req.param("revision"))
    const query = Query.safeParse(context.req.query())
    const duplicates = [...new URL(context.req.url).searchParams.keys()].some(
      (key) => context.req.queries(key)?.length !== 1,
    )
    if (!revision.success || !query.success || duplicates)
      return context.json({ error: "Missing reference" }, 404)
    const normalization = sources.getNormalization(revision.data)
    if (
      !normalization ||
      !sources
        .listStudiesByEdition(normalization.editionId)
        .some((study) => study.ownerId === context.get("ownerId"))
    )
      return context.json({ error: "Missing reference" }, 404)
    const edition = sources.getEdition(normalization.editionId)
    if (!edition) return context.json({ error: "Missing reference" }, 404)
    const resolved =
      query.data.citation === undefined ? null : sources.resolveSpan(query.data.citation)
    if (
      query.data.citation !== undefined &&
      (!resolved ||
        resolved.span.normalizationRevisionId !== normalization.id ||
        resolved.span.editionId !== edition.id)
    )
      return context.json({ error: "Missing reference" }, 404)
    const chapter = resolved
      ? normalization.resources.findIndex((item) => item.path === resolved.span.resourcePath)
      : (query.data.chapter ?? 0)
    if (!normalization.resources[chapter]) return context.json({ error: "Missing reference" }, 404)
    return context.json({ edition, normalization, chapter, span: resolved?.span ?? null })
  })
  app.use("/sources/*", async (context, next) => {
    context.header("Cache-Control", "private, no-store")
    context.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    )
    context.header("Referrer-Policy", "no-referrer")
    context.header("X-Content-Type-Options", "nosniff")
    await next()
  })
  app.get("/sources", async (context) => {
    const documents = sources.listDocuments(context.get("ownerId"))
    const pending = (await queuedImports(importRoot, context.get("ownerId"))).filter(
      (receipt) => !documents.some(({ edition }) => edition.originalHash === receipt.sha256),
    )
    return context.html(
      sourcePage(
        "Your sources",
        html`<p class="eyebrow">PRIVATE LIBRARY</p><h1>Your sources</h1>
      <p>Normalized imports available to your studies. Uploads awaiting normalization are not ready to read.</p>
      ${pending.length > 0 ? html`<h2>Awaiting normalization</h2><ul>${pending.map((receipt) => html`<li><code>${receipt.id}</code><p>Queued · ${receipt.bytes} bytes · Not yet readable</p></li>`)}</ul>` : html``}
      ${documents.length === 0 ? html`<p>No normalized sources available.</p>` : html`<ul>${documents.map(({ edition, normalization }) => html`<li><a href="/sources/${normalization.id}">${edition.title}</a><p>Normalized · ${normalization.coverage} coverage</p><small>Revision: ${normalization.id}</small></li>`)}</ul>`}`,
      ),
    )
  })
  app.get("/sources/:revision", (context) => {
    const revision = NormalizationRevisionId.safeParse(context.req.param("revision"))
    const query = Query.safeParse(context.req.query())
    const duplicates = [...new URL(context.req.url).searchParams.keys()].some(
      (key) => context.req.queries(key)?.length !== 1,
    )
    if (!revision.success || !query.success || duplicates) return context.html(missingSource(), 404)
    const normalization = sources.getNormalization(revision.data)
    if (
      !normalization ||
      !sources
        .listStudiesByEdition(normalization.editionId)
        .some((study) => study.ownerId === context.get("ownerId"))
    )
      return context.html(missingSource(), 404)
    const edition = sources.getEdition(normalization.editionId)
    if (!edition) return context.html(missingSource(), 404)
    const resolved =
      query.data.citation === undefined ? null : sources.resolveSpan(query.data.citation)
    if (
      query.data.citation !== undefined &&
      (!resolved ||
        resolved.span.normalizationRevisionId !== normalization.id ||
        resolved.span.editionId !== edition.id)
    )
      return context.html(missingSource(), 404)
    const chapter = resolved
      ? normalization.resources.findIndex((item) => item.path === resolved.span.resourcePath)
      : (query.data.chapter ?? 0)
    if (!normalization.resources[chapter]) return context.html(missingSource(), 404)
    return context.html(
      sourceReader({ edition, normalization, chapter, span: resolved?.span ?? null }),
    )
  })
}
