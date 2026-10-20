import type { ReactElement } from "react"
import { useContext, useEffect, useState } from "react"
import type { z } from "zod"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { LibraryFrameContext } from "../library/LibraryShell.tsx"
import { ReadSourceLink } from "../library/ReadSourceLink.tsx"
import { Library, Reader, SourceRequestError, sourceRequest } from "./client.ts"
import { SourceDetails, sourceLocation } from "./SourceDetails.tsx"

const headingTags = ["p", "h1", "h2", "h3", "h4", "h5", "h6"] as const

type Load<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "error"; readonly status: number }

function useSource<T>(path: string, schema: z.ZodType<T>): Load<T> {
  const [state, setState] = useState<Load<T>>({ kind: "loading" })
  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: "loading" })
    sourceRequest(path, schema, controller.signal).then(
      (value) => setState({ kind: "ready", value }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          kind: "error",
          status: error instanceof SourceRequestError ? error.status : 500,
        })
      },
    )
    return () => controller.abort()
  }, [path, schema])
  return state
}

export function SourceFrame({ children }: { readonly children: ReactElement }): ReactElement {
  const { t } = useLanguage()
  const libraryFrame = useContext(LibraryFrameContext)
  if (libraryFrame)
    return (
      <div className="source-app">
        <main id="reading" tabIndex={-1}>
          {children}
        </main>
      </div>
    )
  return (
    <div className="source-app">
      <header>
        <a href="/">READING STUDIO</a>
        <a href="/sources">{t("source.frame.sources")}</a>
        <a href="/imports">{t("source.frame.import")}</a>
        <a href="/interviews">{t("source.frame.interviews")}</a>
        <a href="/jobs">{t("source.frame.progress")}</a>
        <a href="#reading">{t("source.frame.skip")}</a>
      </header>
      <main id="reading" tabIndex={-1}>
        {children}
      </main>
      <footer>{t("source.frame.footer")}</footer>
    </div>
  )
}

function MissingSource(): ReactElement {
  const { t } = useLanguage()
  return (
    <hgroup className="workspace-error">
      <h1>{t("source.missing.title")}</h1>
      <p>{t("source.missing.body")}</p>
      <p>
        <a href="/sources">{t("source.missing.back")}</a>
      </p>
    </hgroup>
  )
}

function SourceLibrary(): ReactElement {
  const { t } = useLanguage()
  const state = useSource("/api/source-library", Library)
  if (state.kind === "loading")
    return (
      <p className="workspace-loading" role="status">
        {t("source.library.loading")}
      </p>
    )
  if (state.kind === "error") return <p role="alert">{t("source.library.error")}</p>
  const { documents, pending } = state.value
  return (
    <>
      <p className="eyebrow">{t("source.library.eyebrow")}</p>
      <h1>{t("source.library.title")}</h1>
      <p>{t("source.library.intro")}</p>
      {pending.length > 0 && (
        <section className="intake-status-paper" aria-labelledby="pending-imports-title">
          <h2 id="pending-imports-title">{t("source.library.pending.title")}</h2>
          <ul className="pending-imports">
            {pending.map((receipt) => (
              <li key={receipt.id}>
                <code>{receipt.id}</code>
                <p>{t("source.library.pending.bytes", { bytes: receipt.bytes })}</p>
                <div className="pending-import-status">
                  <strong className="intake-stamp">{t("source.library.pending.queued")}</strong>
                  <strong className="intake-stamp intake-stamp-waiting">
                    {t("source.library.pending.notReadable")}
                  </strong>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {documents.length === 0 ? (
        <p className="workspace-empty">{t("source.library.empty")}</p>
      ) : (
        <ul>
          {documents.map(({ edition, normalization }) => (
            <li key={normalization.id}>
              <ReadSourceLink revision={normalization.id}>{edition.title}</ReadSourceLink>
              <p>
                {t("source.library.coverage", {
                  coverage: t(
                    normalization.coverage === "complete"
                      ? "source.coverage.complete"
                      : "source.coverage.partial",
                  ),
                })}
              </p>
              <small>{t("source.library.revision", { id: normalization.id })}</small>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function SourceReader({ revision }: { readonly revision: string }): ReactElement {
  const { t } = useLanguage()
  const state = useSource(
    `/api/source-reader/${encodeURIComponent(revision)}${window.location.search}`,
    Reader,
  )
  useEffect(() => {
    if (state.kind !== "ready") return
    const target = state.value.span?.blockId ?? "chapter-title"
    document.getElementById(target)?.focus()
  }, [state])
  if (state.kind === "loading")
    return (
      <p className="workspace-loading" role="status">
        {t("source.reader.loading")}
      </p>
    )
  if (state.kind === "error") {
    if (state.status === 401) return <p role="alert">{t("source.reader.retry")}</p>
    if (state.status === 404) return <MissingSource />
    return <p role="alert">{t("source.reader.error")}</p>
  }
  const { edition, normalization, chapter, span } = state.value
  const resource = normalization.resources[chapter]
  const included = normalization.resources.filter((item) => item.status === "included")
  const base = `/sources/${normalization.id}`
  return (
    <>
      <p className="eyebrow">{t("source.reader.eyebrow")}</p>
      <h1>{edition.title}</h1>
      <p>
        <a href={`${base}/setup`}>{t("source.reader.setup")}</a>
      </p>
      <p>
        {t("source.reader.status", {
          coverage: t(
            normalization.coverage === "complete"
              ? "source.coverage.complete"
              : "source.coverage.partial",
          ),
          included: included.length,
          total: normalization.resources.length,
        })}
      </p>
      <SourceDetails edition={edition} normalization={normalization} />
      <div className="reader">
        <nav aria-label={t("source.reader.chapters")}>
          <h2>{t("source.reader.contents")}</h2>
          <ol>
            {normalization.resources.map((item, index) => (
              <li key={item.path}>
                <a
                  href={`${base}?chapter=${index}`}
                  aria-current={index === chapter ? "page" : undefined}
                >
                  {t("source.reader.chapter", { n: index + 1 })}
                </a>
                <small>
                  {item.path} · {item.role}
                  {item.status === "excluded" ? ` · ${t("source.reader.excludedSuffix")}` : ""}
                </small>
              </li>
            ))}
          </ol>
        </nav>
        <article aria-labelledby="chapter-title">
          <h2 id="chapter-title" tabIndex={-1}>
            {t("source.reader.chapter", { n: chapter + 1 })}
          </h2>
          <p className="metadata">{resource?.path}</p>
          {resource?.status === "included" ? (
            resource.blocks.map((block) => {
              const Passage = headingTags.at(block.heading ?? 0) ?? "p"
              return (
                <Passage
                  id={block.id}
                  key={block.id}
                  tabIndex={-1}
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {span?.blockId === block.id ? (
                    <>
                      {block.text.slice(0, span.start)}
                      <mark>{block.text.slice(span.start, span.end)}</mark>
                      {block.text.slice(span.end)}
                    </>
                  ) : (
                    block.text
                  )}
                  <small>{sourceLocation(block, t)}</small>
                </Passage>
              )
            })
          ) : (
            <p className="workspace-empty">
              {t("source.reader.resourceExcluded", {
                reason:
                  resource?.status === "excluded"
                    ? resource.reason
                    : t("source.reader.reasonUnavailable"),
              })}
            </p>
          )}
        </article>
      </div>
    </>
  )
}

export function SourceRoutes(): ReactElement {
  const [, section, revision] = window.location.pathname.split("/")
  return (
    <SourceFrame>
      {section === "sources" && revision ? <SourceReader revision={revision} /> : <SourceLibrary />}
    </SourceFrame>
  )
}
