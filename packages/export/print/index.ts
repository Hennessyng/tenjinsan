import { PublicationRevision, requiredTeachingStates } from "@reading-studio/contracts"
import {
  pairedLabel,
  pairedText,
  readerStyles,
  sceneFigure,
  sceneStyles,
  spatialStyles,
  teachingState,
} from "@reading-studio/reader"
import { html, raw } from "hono/html"
import { type AssetResolver, embedAssets } from "../html/assets.ts"
import { printPractice } from "./practice.ts"

export { printReadiness } from "./readiness.ts"

export async function exportPrint(input: unknown, resolveAsset?: AssetResolver): Promise<string> {
  const { projection } = PublicationRevision.parse(input)
  const assets = await embedAssets(projection, resolveAsset)
  const questions = projection.sections.flatMap((section) =>
    [
      ...section.scenes.map((scene) => ({ prefix: scene.id, practice: scene.practice })),
      { prefix: section.id, practice: section.practice },
    ].flatMap(({ prefix, practice }) =>
      practice
        .filter((exercise) => exercise.kind === "topic")
        .map((exercise) => ({ prefix, exercise })),
    ),
  )
  const document = html`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">
    <title>${projection.title.en} / ${projection.title.ja}</title>
    <style>${raw(readerStyles + sceneStyles + spatialStyles)}
    .print-document { max-width: var(--reading-width); margin-inline: auto; }
    .print-document .pair { grid-template-columns: minmax(0, 1fr); }
    .print-document figure { margin-inline: 0; }
    @media print {
      .pair-label { break-inside: avoid; break-after: avoid; page-break-inside: avoid; page-break-after: avoid; }
      .chapter > .pair, .scene > figure, .practice > [data-scenario], .sources > section > ol > li:first-child { break-before: avoid; page-break-before: avoid; }
      figure, .practice, .states > li, blockquote { break-inside: avoid; }
      .chapter, #print-questions, #print-sources { break-before: page; }
    }</style>${assets.head}</head><body><main class="print-document" data-print-document>
    <h1 class="pair-label">${pairedLabel(projection.title)}</h1>
    ${projection.sections.map(
      (section) => html`<article class="chapter" id="section-${section.id}">
      <h2 class="pair-label">${pairedLabel(section.heading)}</h2>${pairedText(section.content)}
      ${section.scenes.map(
        (
          scene,
        ) => html`<section class="scene" id="scene-${scene.id}" data-print-states="${JSON.stringify(requiredTeachingStates(scene).map((state) => state.id))}">
        <h3 class="pair-label">${pairedLabel(scene.title)}</h3>${sceneFigure(scene, true)}
        <ol class="states">${requiredTeachingStates({ ...scene, practice: [] }).map(teachingState)}</ol>
        ${printPractice(scene.practice, scene.id)}
        ${scene.captions?.map((caption) => html`<aside class="caption" data-caption="${caption.stateId}">${pairedText(caption.text)}</aside>`)}
      </section>`,
      )}${printPractice(section.practice, section.id)}</article>`,
    )}
    ${
      questions.length
        ? html`<section class="sources" id="print-questions"><h2 class="pair-label">${pairedLabel({ en: "Curated question collection", ja: "選んだ質問集" })}</h2>
      ${questions.map(({ prefix, exercise }) => html`<section data-question="${prefix}:${exercise.id}"><h3 class="pair-label">${pairedLabel(exercise.prompt)}</h3><ol>${exercise.options.map((option) => html`<li>${pairedText(option.label)}${pairedText(option.feedback)}</li>`)}</ol></section>`)}
    </section>`
        : html``
    }
    <section id="print-sources" class="sources"><h2 class="pair-label">${pairedLabel({ en: "Sources appendix", ja: "出典付録" })}</h2>
      ${projection.sections.map((section) => html`<section id="sources-${section.id}"><h3 class="pair-label">${pairedLabel(section.heading)}</h3><ol>${section.sourceNotes.map((note) => html`<li data-source="${section.id}:${note.id}"><h4 class="pair-label">${pairedLabel(note.title)}</h4><p class="locator">${note.locator}</p>${note.quotation ? html`<blockquote>${note.quotation}</blockquote>` : html``}${pairedText(note.note)}</li>`)}</ol></section>`)}
    </section>${assets.content}</main></body></html>`
  return (await document).toString()
}
