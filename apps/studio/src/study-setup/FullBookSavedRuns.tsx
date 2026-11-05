import { useState } from "react"
import { z } from "zod"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { sourceRequest } from "../source-viewer/client.ts"
import { FullBookRun } from "./full-book-client.ts"

export function FullBookSavedRuns({
  setupId,
  onSelect,
}: {
  readonly setupId: string
  readonly onSelect: (run: FullBookRun) => void
}) {
  const { t } = useLanguage(),
    [runs, setRuns] = useState<readonly FullBookRun[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false)
  async function load() {
    if (busy) return
    setBusy(true)
    try {
      const response = await sourceRequest(
        `/api/full-book-test/${encodeURIComponent(setupId)}/runs`,
        z.object({ runs: z.array(FullBookRun) }),
        AbortSignal.timeout(15000),
      )
      setRuns(response.runs)
      setMessage(response.runs.length ? "" : t("fullBook.noSavedRuns"))
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setMessage(t("fullBook.runError"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section>
      <button type="button" disabled={busy} onClick={() => void load()}>
        {t("fullBook.savedRuns")}
      </button>
      {message && <p role="status">{message}</p>}
      <ul>
        {runs.map((run) => (
          <li key={run.id}>
            <button type="button" onClick={() => onSelect(run)}>
              {t(`fullBook.run.${run.state}`)} · {run.id}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
