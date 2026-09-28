import type { FormEvent, ReactElement } from "react"
import { useState } from "react"
import type { z } from "zod"
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
  const [provider, setProvider] = useState<SetupSelection["provider"]>(
    choices[0]?.provider ?? "openai",
  )
  const [scope, setScope] = useState<SetupSelection["scope"]>(
    complete ? "all-main-chapters" : "partial",
  )
  const [chapters, setChapters] = useState<readonly string[]>([])
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    onSubmit({ provider, scope, chapters })
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
          value={provider}
          onChange={(event) =>
            setProvider(event.target.value === "anthropic" ? "anthropic" : "openai")
          }
        >
          {choices.map((choice) => (
            <option key={choice.provider} value={choice.provider}>
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
          API access is separate from ChatGPT or Claude chat subscriptions. Keys stay on the server.
        </p>
        <button type="submit" disabled={busy}>
          Review transmission
        </button>
      </form>
    </section>
  )
}
