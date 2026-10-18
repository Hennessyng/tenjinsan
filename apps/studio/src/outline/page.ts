import type { OutlineView, ReadingBrief, StudySetupRevision } from "@reading-studio/contracts"
import { translate, type UiLocale } from "@reading-studio/contracts/i18n"
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
  readonly locale?: UiLocale
}) {
  const locale = input.locale ?? "en"
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate(locale, key, params)
  const { view, brief } = input
  const questions = brief ? [brief.guidingQuestion, ...brief.supportingQuestions] : []
  const content = view?.draft.content
  const current = view && view.status !== "outdated"
  return sourcePage(
    t("outline.title"),
    html`<section class="setup">
    <p class="eyebrow">${t("outline.eyebrow")}</p>
    <h1>${t("outline.title")}</h1>
    <nav><a href="/briefs/${input.studyId}?lang=${locale}">${t("brief.title")}</a></nav>
    <p>${t(input.fixture ? "outline.fixture" : input.providerReady ? "outline.provider" : "outline.blocked")}</p>
    ${input.error ? html`<p role="alert" tabindex="-1" autofocus>${t("outline.error")}</p>` : html``}
    ${!brief ? html`<p>${t("outline.briefRequired")}</p>` : html``}
    ${view ? html`<p role="status">${{ pending: t("outline.status.pending"), approved: t("outline.status.approved"), revise: t("brief.status.revise"), defer: t("brief.status.defer"), outdated: t("outline.status.outdated") }[view.status]}</p><p class="metadata">${t("brief.revision")} ${view.draft.id}</p>` : html``}
    ${
      content
        ? html`<h2>${content.title.en}</h2><p lang="ja">${content.title.ja}</p>
       <h2>${t("outline.theme")}</h2><p>${content.theme.en}</p><p lang="ja">${content.theme.ja}</p>
       <h2>${t("outline.order")}</h2><ol>${content.sections.map(
         (section) => html`<li><article>
        <h3>${section.title.en}</h3><p lang="ja">${section.title.ja}</p>
         <p>${t("outline.question", { n: section.questionIndex + 1 })} ${questions[section.questionIndex]?.en ?? t("outline.questionMissing")}</p>
         <h4>${t("outline.goals")}</h4><ul>${section.learningGoals.map((goal) => html`<li>${goal.en}<p lang="ja">${goal.ja}</p></li>`)}</ul>
         <h4>${t("outline.evidence")}</h4><ul>${section.sources.map((source) => html`<li>${source.resourcePath} · ${source.blockId} · ${source.start}–${source.end}</li>`)}</ul>
         <h4>${t("outline.visuals")}</h4><p>${t(section.visualKind === "illustrative-model" ? "outline.illustrative" : "outline.grounded")}</p>
        ${section.visualIntents.map((visual) => html`<p>${visual.en}</p><p lang="ja">${visual.ja}</p>`)}
         ${section.flags.map((flag) => html`<p role="alert">${t("outline.reviewFlag", { flag })}</p>`)}
      </article></li>`,
       )}</ol>
       <h2>${t("outline.qualifications")}</h2>${content.qualifications.length ? html`<ul>${content.qualifications.map((item) => html`<li>${item.text}<small>${item.sources.map((source) => `${source.resourcePath}:${source.blockId}`).join(", ")}</small></li>`)}</ul>` : html`<p>${t("outline.noQualifications")}</p>`}
       <h2>${t("outline.excluded")}</h2><ul>${content.excludedAreas.map((item) => html`<li>${item}</li>`)}${input.scope?.exclusions.map((item) => html`<li>${item.resourcePath}: ${item.blockIds.join(", ")}</li>`)}</ul>
       ${view?.draft.feedback?.kind === "custom" ? html`<p>${t("outline.savedCustom", { text: view.draft.feedback.text })}</p>` : html``}
    `
        : html``
    }
     ${brief && (input.fixture || input.providerReady) && (!view || view.status === "outdated") ? html`<form method="post"><input type="hidden" name="action" value="generate"><input type="hidden" name="briefRevisionId" value="${brief.id}"><input type="hidden" name="expectedRevisionId" value="${view?.draft.id ?? ""}"><button>${t(input.fixture ? "outline.generateFixture" : "outline.generate")}</button></form>` : html``}
    ${
      current
        ? html`<form method="post"><input type="hidden" name="revisionId" value="${view.draft.id}"><div class="actions">
       <button name="action" value="approve" ${view.status === "revise" || content?.sections.some((section) => section.flags.length) ? html`disabled` : html``}>${t("outline.approve")}</button>
       <button name="action" value="defer">${t("brief.defer")}</button><button name="action" value="revise">${t("outline.revise")}</button></div></form>
      ${
        input.fixture || input.providerReady
          ? html`<h2>${t("outline.change")}</h2>
       <form method="post"><input type="hidden" name="action" value="choice"><input type="hidden" name="revisionId" value="${view.draft.id}"><label for="revision-choice">${t("outline.choice")}</label><select id="revision-choice" name="value"><option value="reverse-order">${t("outline.reverse")}</option><option value="simplify-visuals">${t("outline.simplify")}</option></select><button>${t("outline.apply")}</button></form>
       <form method="post"><input type="hidden" name="action" value="custom"><input type="hidden" name="revisionId" value="${view.draft.id}"><label for="custom">${t("outline.custom")}</label><input id="custom" name="text" required maxlength="2000"><button>${t("outline.applyCustom")}</button></form>`
          : html``
      }`
        : html``
    }
     <p>${t(view?.status === "approved" && input.providerReady ? "outline.lessonQueued" : view?.status === "approved" ? "outline.fixtureApproved" : "outline.sectionsBlocked")}</p>
     ${input.providerReady ? html`` : html`<button disabled>${t("outline.sections")}</button>`}
     <p><a href="/evidence/${input.studyId}?lang=${locale}">${t("outline.evidenceLink")}</a></p>
  </section>`,
    locale,
  )
}
