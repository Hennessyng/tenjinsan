import type { OutlineView, ReadingBrief, StudySetupRevision } from "@reading-studio/contracts"
import { html } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"

export function outlinePage(input: {
  readonly view: OutlineView | null
  readonly brief: ReadingBrief | null
  readonly scope: StudySetupRevision["analysis"]["scope"] | null
  readonly studyId: string
  readonly fixture: boolean
  readonly providerReady?: boolean
  readonly error: boolean
}) {
  const { view, brief } = input
  const questions = brief ? [brief.guidingQuestion, ...brief.supportingQuestions] : []
  const content = view?.draft.content
  const current = view && view.status !== "outdated"
  return sourcePage(
    "Study outline / 学習の構成",
    html`<section class="setup">
    <p class="eyebrow">READING / TEACHING SEQUENCE</p>
    <h1>Study outline / <span lang="ja">学習の構成</span></h1>
    <nav><a href="/briefs/${input.studyId}">Reading brief / <span lang="ja">読書方針</span></a></nav>
    <p>${input.fixture ? "Fixture provider only; no live generation or cloud transmission." : input.providerReady ? "Provider-backed outline requests are queued under the approved transmission grant; refresh to review the result." : "Live generation blocked: no live outline provider is configured. Fixture verification is separate."}</p>
    ${input.error ? html`<p role="alert" tabindex="-1" autofocus>Unable to proceed: stale revision, missing approval or unresolved flags. Review the current outline.</p>` : html``}
    ${!brief ? html`<p>Approve the current reading brief before generating an outline. / <span lang="ja">先に読書方針を承認してください。</span></p>` : html``}
    ${view ? html`<p role="status">${{ pending: "Awaiting outline approval", approved: "Outline approved", revise: "Revision requested", defer: "Decision deferred", outdated: "Outdated: review the current brief" }[view.status]}</p><p class="metadata">Revision: ${view.draft.id}</p>` : html``}
    ${
      content
        ? html`<h2>${content.title.en}</h2><p lang="ja">${content.title.ja}</p>
      <h2>Theme / <span lang="ja">主題</span></h2><p>${content.theme.en}</p><p lang="ja">${content.theme.ja}</p>
      <h2>Section order / <span lang="ja">学ぶ順序</span></h2><ol>${content.sections.map(
        (section) => html`<li><article>
        <h3>${section.title.en}</h3><p lang="ja">${section.title.ja}</p>
        <p>Approved question ${section.questionIndex + 1}: ${questions[section.questionIndex]?.en ?? "Not in current brief"}</p>
        <h4>Learning goals / <span lang="ja">学習目標</span></h4><ul>${section.learningGoals.map((goal) => html`<li>${goal.en}<p lang="ja">${goal.ja}</p></li>`)}</ul>
        <h4>Evidence / <span lang="ja">根拠</span></h4><ul>${section.sources.map((source) => html`<li>${source.resourcePath} · ${source.blockId} · ${source.start}–${source.end}</li>`)}</ul>
        <h4>Visual intentions / <span lang="ja">図解の意図</span></h4><p>${section.visualKind === "illustrative-model" ? "Illustrative model — not an author claim" : "Source-grounded visual claim"}</p>
        ${section.visualIntents.map((visual) => html`<p>${visual.en}</p><p lang="ja">${visual.ja}</p>`)}
        ${section.flags.map((flag) => html`<p role="alert">Review required: ${flag}</p>`)}
      </article></li>`,
      )}</ol>
      <h2>Retained qualifications / <span lang="ja">保持する留保</span></h2>${content.qualifications.length ? html`<ul>${content.qualifications.map((item) => html`<li>${item.text}<small>${item.sources.map((source) => `${source.resourcePath}:${source.blockId}`).join(", ")}</small></li>`)}</ul>` : html`<p>No qualifications recorded in this analysis; this is not a claim that none exist.</p>`}
      <h2>Excluded areas / <span lang="ja">扱わない範囲</span></h2><ul>${content.excludedAreas.map((item) => html`<li>${item}</li>`)}${input.scope?.exclusions.map((item) => html`<li>${item.resourcePath}: ${item.blockIds.join(", ")}</li>`)}</ul>
      ${view?.draft.feedback?.kind === "custom" ? html`<p>Saved custom request (original language): ${view.draft.feedback.text}</p>` : html``}
    `
        : html``
    }
    ${brief && (input.fixture || input.providerReady) && (!view || view.status === "outdated") ? html`<form method="post"><input type="hidden" name="action" value="generate"><input type="hidden" name="briefRevisionId" value="${brief.id}"><input type="hidden" name="expectedRevisionId" value="${view?.draft.id ?? ""}"><button>${input.fixture ? "Generate fixture outline" : "Queue outline generation"}</button></form>` : html``}
    ${
      current
        ? html`<form method="post"><input type="hidden" name="revisionId" value="${view.draft.id}"><div class="actions">
      <button name="action" value="approve" ${view.status === "revise" || content?.sections.some((section) => section.flags.length) ? html`disabled` : html``}>Approve outline / 承認する</button>
      <button name="action" value="defer">Defer / 保留する</button><button name="action" value="revise">Request revision / 修正する</button></div></form>
      ${
        input.fixture || input.providerReady
          ? html`<h2>How should the sequence change? / <span lang="ja">構成をどう変えますか？</span></h2>
      <form method="post"><input type="hidden" name="action" value="choice"><input type="hidden" name="revisionId" value="${view.draft.id}"><label for="revision-choice">Revision choice / 修正案</label><select id="revision-choice" name="value"><option value="reverse-order">Reverse section order / 順序を逆にする</option><option value="simplify-visuals">Simplify visuals / 図解を簡潔にする</option></select><button>Apply selected revision</button></form>
      <form method="post"><input type="hidden" name="action" value="custom"><input type="hidden" name="revisionId" value="${view.draft.id}"><label for="custom">Your own visual intention / 独自の図解案</label><input id="custom" name="text" required maxlength="2000"><button>Apply custom revision</button></form>`
          : html``
      }`
        : html``
    }
    <p>${view?.status === "approved" && input.providerReady ? "Approved. Bilingual lesson generation is queued; refresh the evidence page to review the result." : view?.status === "approved" ? "Approval recorded. Section generation is not implemented in Task18." : "Section generation blocked until this exact outline is approved."}</p>
    ${input.providerReady ? html`` : html`<button disabled>Generate sections / 本文を生成</button>`}
    <p><a href="/evidence/${input.studyId}">Review generated lesson evidence / <span lang="ja">生成済み本文の根拠を確認</span></a></p>
  </section>`,
  )
}
