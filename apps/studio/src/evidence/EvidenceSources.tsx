import type { ReactElement } from "react"
import type { Evidence } from "./client.ts"

export function EvidenceSources({ value }: { readonly value: Evidence }): ReactElement {
  const { mechanical } = value.view
  return (
    <>
      <h2>
        1. Source integrity / <span lang="ja">出典の整合性</span>
      </h2>
      <p>
        {mechanical.length
          ? "Broken locators or unsupported quotations cannot be acknowledged away."
          : "Locators and quotations match stored text. This does not establish semantic support."}
      </p>
      <ul>
        {mechanical.map((flag) => (
          <li role="alert" key={`${flag.category}-${flag.path}`}>
            {flag.category}: <code>{flag.path}</code>
          </li>
        ))}
      </ul>
      <details>
        <summary>Compare original source passages / 原文と比較</summary>
        {value.references.map((reference) => (
          <div key={reference.href}>
            <p>
              <a href={reference.href}>{reference.title}</a>
            </p>
            <blockquote>{reference.text}</blockquote>
          </div>
        ))}
      </details>
    </>
  )
}
