import type { FormEvent, ReactElement } from "react"
import { useState } from "react"
import { z } from "zod"

const Receipt = z.object({
  id: z.string(),
  state: z.literal("queued"),
  bytes: z.number().int().nonnegative(),
})

export function ImportBook(): ReactElement {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<z.infer<typeof Receipt> | null>(null)
  const [error, setError] = useState("")

  async function upload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!file) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/imports/upload", {
        method: "POST",
        headers: { "Content-Type": "application/epub+zip" },
        credentials: "same-origin",
        body: file,
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok) {
        const failure = z.object({ error: z.string() }).safeParse(await response.json())
        setError(
          failure.success
            ? `Import refused: ${failure.data.error}`
            : "Import refused. Please try again.",
        )
        return
      }
      setReceipt(Receipt.parse(await response.json()))
    } catch (failure) {
      if (failure instanceof Error)
        setError("Import interrupted. Check your connection and try again.")
      else throw failure
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="source-app import-book" aria-labelledby="import-title">
      <div className="import-content">
        <header className="intake-heading">
          <p className="eyebrow">ACCESSION DESK / 受入カウンター</p>
          <h2 id="import-title">Import a book</h2>
          <p>Place an EPUB in the intake tray to add it to your private library.</p>
        </header>
        <div className="intake-layout">
          <div className="intake-paper">
            <h3>
              Intake tray <span lang="ja">受入トレイ</span>
            </h3>
            <p>The book stays here while the library checks and prepares it.</p>
            <form
              className="intake-tray"
              onSubmit={(event) => {
                void upload(event)
              }}
            >
              <label htmlFor="epub-file">Choose EPUB</label>
              <input
                id="epub-file"
                type="file"
                accept=".epub,application/epub+zip"
                required
                onChange={(event) => setFile(event.currentTarget.files?.item(0) ?? null)}
              />
              <button
                className={busy ? "workspace-loading" : undefined}
                type="submit"
                disabled={busy || !file}
              >
                {busy ? "Importing…" : "Import EPUB"}
              </button>
            </form>
          </div>
          <aside className="intake-note" aria-label="Private import note">
            <h3>Private import</h3>
            <p>
              The EPUB stays in your private library. Importing does not authorize provider
              transmission.
            </p>
          </aside>
        </div>
        {error && (
          <div className="intake-outcome intake-outcome-refused" role="alert">
            <strong className="intake-stamp intake-stamp-refused">Refused</strong>
            <p>{error}</p>
          </div>
        )}
        {receipt && (
          <div className="intake-outcome intake-outcome-accepted" role="status">
            <strong className="intake-stamp">Queued</strong>
            <div>
              <h3>{error ? "Earlier acceptance" : "Import accepted"}</h3>
              <p>
                {receipt.id} · {receipt.bytes} bytes · Not yet readable
              </p>
              <a href="/sources">View your sources</a>
            </div>
          </div>
        )}
        <p>
          <a href="/sources">Your sources / 資料一覧</a>
        </p>
      </div>
    </section>
  )
}
