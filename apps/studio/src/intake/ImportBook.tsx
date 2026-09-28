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
        <p className="eyebrow">PRIVATE LIBRARY / 資料を追加</p>
        <h2 id="import-title">Import a book</h2>
        <p>
          Choose an EPUB from your device. It stays in your private library; importing does not
          authorize provider transmission.
        </p>
        <form
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
          <button type="submit" disabled={busy || !file}>
            {busy ? "Importing…" : "Import EPUB"}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        {receipt && (
          <p role="status">
            Import accepted: {receipt.id} · {receipt.bytes} bytes.{" "}
            <a href="/sources">View your sources</a>
          </p>
        )}
        <p>
          <a href="/sources">Your sources / 資料一覧</a>
        </p>
      </div>
    </section>
  )
}
