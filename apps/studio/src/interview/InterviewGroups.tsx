import type { ReactElement } from "react"
import type { Interview } from "./client.ts"
import { type InterviewLanguage, interviewCopy } from "./copy.ts"

export function InterviewGroups({
  definition,
  language,
  link,
}: {
  readonly definition: Interview["definition"]
  readonly language: InterviewLanguage
  readonly link: (id: string) => string
}): ReactElement {
  const copy = interviewCopy[language]
  return (
    <>
      <h2>{copy.browse}</h2>
      {definition.groups.map((group) => (
        <details key={group.id}>
          <summary>{group.label[language]}</summary>
          <ul>
            {definition.steps
              .filter((item) => item.groupId === group.id)
              .map((item) => (
                <li key={item.question.id}>
                  <a href={link(item.question.id)}>
                    {item.question.lens?.label[language] ?? item.question.prompt[language]}
                  </a>
                </li>
              ))}
          </ul>
        </details>
      ))}
    </>
  )
}
