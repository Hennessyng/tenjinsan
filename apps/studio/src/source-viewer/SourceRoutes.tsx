import type { ReactElement } from "react"
import { useEffect, useState } from "react"
import type { z } from "zod"
import { Library, Reader, SourceRequestError, sourceRequest } from "./client.ts"

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

export function SourceFrame({
  children,
  language = "en",
}: {
  readonly children: ReactElement
  readonly language?: "en" | "ja"
}): ReactElement {
  return (
    <div className="source-app">
      <header>
        <a href="/">READING STUDIO</a>
        <a href="/sources">{language === "en" ? "Your sources" : "資料一覧"}</a>
        <a href="/imports">{language === "en" ? "Import a book" : "本を追加"}</a>
        <a href="/interviews">{language === "en" ? "Reading interviews" : "読書の質問"}</a>
        <a href="/jobs">
          Study progress / <span lang="ja">学習の進行状況</span>
        </a>
        <a href="#reading">{language === "en" ? "Skip to reading" : "本文へ移動"}</a>
      </header>
      <main id="reading">{children}</main>
      <footer>
        {language === "en"
          ? "Private source reader · Text only · No external resources"
          : "非公開の資料 · テキストのみ · 外部への接続なし"}
      </footer>
    </div>
  )
}

function MissingSource(): ReactElement {
  return (
    <hgroup>
      <h1>Missing reference</h1>
      <p>This source, chapter or citation is unavailable in this edition and normalization.</p>
      <p>
        <a href="/sources">Return to your sources</a>
      </p>
    </hgroup>
  )
}

function SourceLibrary(): ReactElement {
  const state = useSource("/api/source-library", Library)
  if (state.kind === "loading") return <p role="status">Loading sources</p>
  if (state.kind === "error") return <p role="alert">Sources unavailable. Please try again.</p>
  const { documents, pending } = state.value
  return (
    <>
      <p className="eyebrow">PRIVATE LIBRARY</p>
      <h1>Your sources</h1>
      <p>
        Normalized imports available to your studies. Uploads awaiting normalization are not ready
        to read.
      </p>
      {pending.length > 0 && (
        <>
          <h2>Awaiting normalization</h2>
          <ul>
            {pending.map((receipt) => (
              <li key={receipt.id}>
                <code>{receipt.id}</code>
                <p>Queued · {receipt.bytes} bytes · Not yet readable</p>
              </li>
            ))}
          </ul>
        </>
      )}
      {documents.length === 0 ? (
        <p>No normalized sources available.</p>
      ) : (
        <ul>
          {documents.map(({ edition, normalization }) => (
            <li key={normalization.id}>
              <a href={`/sources/${normalization.id}`}>{edition.title}</a>
              <p>Normalized · {normalization.coverage} coverage</p>
              <small>Revision: {normalization.id}</small>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function SourceReader({ revision }: { readonly revision: string }): ReactElement {
  const state = useSource(
    `/api/source-reader/${encodeURIComponent(revision)}${window.location.search}`,
    Reader,
  )
  useEffect(() => {
    if (state.kind !== "ready") return
    const target = state.value.span?.blockId ?? "chapter-title"
    document.getElementById(target)?.focus()
  }, [state])
  if (state.kind === "loading") return <p role="status">Loading source</p>
  if (state.kind === "error") {
    if (state.status === 401) return <p role="alert">Sign in to read your sources.</p>
    if (state.status === 404) return <MissingSource />
    return <p role="alert">Source unavailable. Please try again.</p>
  }
  const { edition, normalization, chapter, span } = state.value
  const resource = normalization.resources[chapter]
  const included = normalization.resources.filter((item) => item.status === "included")
  const exclusions = normalization.resources.filter((item) => item.status === "excluded")
  const base = `/sources/${normalization.id}`
  return (
    <>
      <p className="eyebrow">SOURCE / NORMALIZED TEXT</p>
      <h1>{edition.title}</h1>
      <p>
        <a href={`${base}/setup`}>Set up a study</a>
      </p>
      <p>
        Import status: normalized ·{" "}
        <strong>
          {normalization.coverage === "complete" ? "Complete coverage" : "Partial coverage"}
        </strong>{" "}
        · {included.length} of {normalization.resources.length} resources included
      </p>
      <details>
        <summary>Coverage and edition details</summary>
        <p>
          Original SHA-256: <code>{edition.originalHash}</code>
        </p>
        <p>
          Revision: <code>{normalization.id}</code>
          <br />
          Parser: {normalization.parserVersion} · Normalizer: {normalization.normalizerVersion}
        </p>
        <p>Publisher page labels belong to this edition, not other editions or screen pages.</p>
        {exclusions.map((item) => (
          <p key={item.path}>
            Excluded: {item.path} — {item.reason}
          </p>
        ))}
      </details>
      <div className="reader">
        <nav aria-label="Chapters">
          <h2>Contents</h2>
          <ol>
            {normalization.resources.map((item, index) => (
              <li key={item.path}>
                <a
                  href={`${base}?chapter=${index}`}
                  aria-current={index === chapter ? "page" : undefined}
                >
                  Chapter {index + 1}
                </a>
                <small>
                  {item.path} · {item.role}
                  {item.status === "excluded" ? " · excluded" : ""}
                </small>
              </li>
            ))}
          </ol>
        </nav>
        <article aria-labelledby="chapter-title">
          <h2 id="chapter-title" tabIndex={-1}>
            Chapter {chapter + 1}
          </h2>
          <p className="metadata">{resource?.path}</p>
          {resource?.status === "included" ? (
            resource.blocks.map((block) => (
              <p id={block.id} key={block.id} tabIndex={-1}>
                {span?.blockId === block.id ? (
                  <>
                    {block.text.slice(0, span.start)}
                    <mark>{block.text.slice(span.start, span.end)}</mark>
                    {block.text.slice(span.end)}
                  </>
                ) : (
                  block.text
                )}
                <small>
                  {block.pageLabel === undefined
                    ? "Page label unavailable"
                    : `Page ${block.pageLabel}`}
                </small>
              </p>
            ))
          ) : (
            <p>
              This resource was excluded:{" "}
              {resource?.status === "excluded" ? resource.reason : "unavailable"}. No source text is
              available.
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
