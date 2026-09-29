import type { FormEvent, ReactElement } from "react"
import { useState } from "react"
import { z } from "zod"
import { SourceRequestError, sourceCommand } from "../source-viewer/client.ts"
import type { SetupChoices as ChoicesSchema, SetupSelection } from "./client.ts"

type Choices = z.infer<typeof ChoicesSchema>

export function SetupChoices({
  value,
  onSubmit,
  busy,
}: {
  readonly value: Choices
  readonly onSubmit: (selection: SetupSelection) => void
  readonly busy: boolean
}): ReactElement {
  const { normalization, choices } = value
  const main = normalization.resources.filter((resource) => resource.role === "main-chapter")
  const complete = main.length > 0 && main.every((resource) => resource.status === "included")
  const [selection, setSelection] = useState("0")
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [connectionBusy, setConnectionBusy] = useState(false)
  const [connectionError, setConnectionError] = useState(false)
  async function connection(action: "connect" | "disconnect") {
    setConnectionBusy(true)
    setConnectionError(false)
    try {
      const result = await sourceCommand(
        `/api/provider-connections/codex/${action}`,
        {},
        z.object({ authUrl: z.url().optional() }),
      )
      setAuthUrl(result.authUrl ?? null)
      if (action === "disconnect") window.location.reload()
    } catch (error) {
      if (error instanceof SourceRequestError) setConnectionError(true)
      else throw error
    } finally {
      setConnectionBusy(false)
    }
  }
  const [scope, setScope] = useState<SetupSelection["scope"]>(
    complete ? "all-main-chapters" : "partial",
  )
  const [chapters, setChapters] = useState<readonly string[]>([])
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const choice = choices[Number(selection)]
    if (choice) onSubmit({ provider: choice.provider, model: choice.model, scope, chapters })
  }
  return (
    <section className="setup">
      <p className="eyebrow">STUDY / PRIVATE BY DEFAULT</p>
      <h1>Set up a study</h1>
      <p>
        Choose what leaves this device. Nothing is sent until you review and approve transmission.
      </p>
      <p>
        <a href={`/sources/${normalization.id}`}>Back to source preview</a>
      </p>
      <form onSubmit={submit}>
        <label htmlFor="provider">Provider and model</label>
        <select
          id="provider"
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
        >
          {choices.map((choice, index) => (
            <option key={`${choice.provider}/${choice.model}`} value={index}>
              {choice.label}
            </option>
          ))}
        </select>
        <fieldset>
          <legend>Source scope</legend>
          <label>
            <input
              type="radio"
              name="scope"
              value="all-main-chapters"
              checked={scope === "all-main-chapters"}
              disabled={!complete}
              onChange={() => setScope("all-main-chapters")}
            />{" "}
            All main chapters
          </label>
          <label>
            <input
              type="radio"
              name="scope"
              value="partial"
              checked={scope === "partial"}
              onChange={() => setScope("partial")}
            />{" "}
            Choose specific chapters
          </label>
          {!complete && (
            <p>Some main chapters are unavailable. Only explicit partial scope is possible.</p>
          )}
          {normalization.resources.map((resource) =>
            resource.status === "included" ? (
              <label key={resource.path}>
                <input
                  type="checkbox"
                  checked={chapters.includes(resource.path)}
                  onChange={(event) =>
                    setChapters(
                      event.target.checked
                        ? [...chapters, resource.path]
                        : chapters.filter((path) => path !== resource.path),
                    )
                  }
                />{" "}
                {resource.path}
              </label>
            ) : (
              <p key={resource.path}>
                Unavailable: {resource.path} ({resource.reason})
              </p>
            ),
          )}
        </fieldset>
        <p>
          OpenRouter and Anthropic use server-owned API keys. Codex uses official subscription
          sign-in. Studio caps: 64 calls, 32,000 request bytes, 6,000 output tokens. Codex output is
          checked after receipt.
        </p>
        <button type="submit" disabled={busy || !choices[Number(selection)]}>
          Review transmission
        </button>
      </form>
      <h2>Codex connection</h2>
      <p role="status">
        {choices.some((choice) => choice.provider === "codex") ? "Connected" : "Unavailable"}
      </p>
      {connectionError && <p role="alert">Official Codex route unavailable. No study was sent.</p>}
      {authUrl && (
        <p>
          <a href={authUrl} target="_blank" rel="noreferrer">
            Continue official Codex sign-in
          </a>
        </p>
      )}
      <div className="setup-actions">
        <button type="button" disabled={connectionBusy} onClick={() => void connection("connect")}>
          Connect Codex
        </button>
        <button
          type="button"
          disabled={connectionBusy}
          onClick={() => void connection("disconnect")}
        >
          Disconnect Codex
        </button>
        <button type="button" onClick={() => window.location.reload()}>
          Refresh connection and models
        </button>
      </div>
    </section>
  )
}
