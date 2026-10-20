import type { CatalogKey } from "@reading-studio/contracts/i18n"
import type { FormEvent, ReactElement } from "react"
import { useLayoutEffect, useRef, useState } from "react"
import { z } from "zod"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { ReadSourceLink } from "../library/ReadSourceLink.tsx"
import { captureEditSave } from "../library/useUnsavedEdits.ts"
import { Receipt, useImportReceipt } from "./receipt.tsx"

const media = [
  ["epub", "application/epub+zip"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["txt", "text/plain"],
  ["pdf", "application/pdf"],
] as const
const SafeCode = z.enum([
  "unsafe-xml",
  "invalid-xml",
  "invalid-package",
  "unsafe-reference",
  "invalid-encoding",
  "empty-text",
  "protected-document",
  "invalid-pdf",
  "limit-exceeded",
  "unsupported-media-type",
  "invalid-archive",
  "invalid-epub",
  "unsafe-path",
  "encrypted-content",
  "invalid-encryption",
])

const codeLabels = {
  "unsafe-xml": "import.code.unsafeXml",
  "invalid-xml": "import.code.invalidXml",
  "invalid-package": "import.code.invalidPackage",
  "unsafe-reference": "import.code.unsafeReference",
  "invalid-encoding": "import.code.invalidEncoding",
  "empty-text": "import.code.emptyText",
  "protected-document": "import.code.protectedDocument",
  "invalid-pdf": "import.code.invalidPdf",
  "limit-exceeded": "import.code.limitExceeded",
  "unsupported-media-type": "import.code.unsupportedMediaType",
  "invalid-archive": "import.code.invalidArchive",
  "invalid-epub": "import.code.invalidEpub",
  "unsafe-path": "import.code.unsafePath",
  "encrypted-content": "import.code.encryptedContent",
  "invalid-encryption": "import.code.invalidEncryption",
} as const satisfies Readonly<Record<z.infer<typeof SafeCode>, CatalogKey>>

export function ImportBook(): ReactElement {
  const { t } = useLanguage()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useImportReceipt()
  const [error, setError] = useState("")
  const outcome = useRef<HTMLDivElement>(null)
  const focusReceipt = useRef(false)
  useLayoutEffect(() => {
    if (!focusReceipt.current || !receipt) return
    focusReceipt.current = false
    outcome.current?.focus()
  }, [receipt])

  async function upload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const committed = captureEditSave()
    if (!file || busy) return
    const contentType = media.find(([extension]) =>
      file.name.toLowerCase().endsWith(`.${extension}`),
    )?.[1]
    if (!contentType) {
      setError(t("import.refusedWith", { reason: t(codeLabels["unsupported-media-type"]) }))
      return
    }
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/imports/upload", {
        method: "POST",
        headers: { "Content-Type": contentType },
        credentials: "same-origin",
        body: file,
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok) {
        const failure = z.object({ error: SafeCode }).safeParse(await response.json())
        setError(
          failure.success
            ? t("import.refusedWith", { reason: t(codeLabels[failure.data.error]) })
            : t("import.refusedGeneric"),
        )
        return
      }
      const accepted = Receipt.parse(await response.json())
      focusReceipt.current = true
      setReceipt(accepted)
      committed()
    } catch (failure) {
      if (failure instanceof Error) setError(t("import.interrupted"))
      else throw failure
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="source-app import-book" aria-labelledby="import-title">
      <div className="import-content">
        <header className="intake-heading">
          <p className="eyebrow">{t("import.eyebrow")}</p>
          <h2 id="import-title">{t("import.title")}</h2>
          <p>{t("import.intro")}</p>
        </header>
        <div className="intake-layout">
          <div className="intake-paper">
            <h3>{t("import.tray.title")}</h3>
            <p>{t("import.tray.body")}</p>
            <form
              className="intake-tray"
              onSubmit={(event) => {
                void upload(event)
              }}
            >
              <label htmlFor="epub-file">{t("import.choose")}</label>
              <input
                id="epub-file"
                type="file"
                accept=".epub,.docx,.txt,.pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/pdf"
                required
                disabled={busy}
                onChange={(event) => setFile(event.currentTarget.files?.item(0) ?? null)}
              />
              <button
                className={busy ? "workspace-loading" : undefined}
                type="submit"
                disabled={busy || !file}
              >
                {busy ? t("import.busy") : t("import.submit")}
              </button>
            </form>
          </div>
          <aside className="intake-note" aria-label={t("import.note.aria")}>
            <h3>{t("import.note.title")}</h3>
            <p>{t("import.note.body")}</p>
          </aside>
        </div>
        {error && (
          <div className="intake-outcome intake-outcome-refused" role="alert">
            <strong className="intake-stamp intake-stamp-refused">{t("import.refused")}</strong>
            <p>{error}</p>
          </div>
        )}
        {receipt && (
          <div
            className="intake-outcome intake-outcome-accepted"
            role="status"
            ref={outcome}
            tabIndex={-1}
          >
            <strong className="intake-stamp">
              {receipt.normalizationRevisionId
                ? t("import.status.normalized")
                : t("import.status.queued")}
            </strong>
            <div>
              <h3>{error ? t("import.earlier") : t("import.accepted")}</h3>
              <p>
                {t("import.receipt", {
                  id: receipt.id,
                  bytes: receipt.bytes,
                  status: receipt.normalizationRevisionId
                    ? t("import.ready")
                    : t("import.notReadable"),
                })}
              </p>
              <a href="/sources">{t("import.viewSources")}</a>
              {receipt.normalizationRevisionId && (
                <p>
                  <ReadSourceLink revision={receipt.normalizationRevisionId}>
                    {t("import.readSource")}
                  </ReadSourceLink>
                </p>
              )}
            </div>
          </div>
        )}
        <p>
          <a href="/sources">{t("import.yourSources")}</a>
        </p>
      </div>
    </section>
  )
}
