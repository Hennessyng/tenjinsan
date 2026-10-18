import {
  assertNever,
  type ExportUi,
  requiredTeachingStates,
  type SceneSpec,
} from "@reading-studio/contracts"
import { html } from "hono/html"
import { pairedLabel } from "./primitives.ts"
import { spatialFigure } from "./spatial-figure.ts"
import { fixedUi, fixedUiBlock, fixedUiText } from "./ui.ts"

// Drawing coordinates follow the diagram grid in DESIGN.md, independent of viewport pixels.
function drawing(scene: SceneSpec, count: number) {
  const marks = Array.from({ length: count }, (_, index) => index)
  switch (scene.kind) {
    case "layered-diagram":
      return {
        height: count * 64 + 64,
        marks: marks.map(
          (index) => html`<g>
          <rect data-scene-mark x="${32 + (index % 3) * 16}" y="${32 + index * 64}" width="224" height="88"/>
          <text x="${64 + (index % 3) * 16}" y="${64 + index * 64}">${index + 1}</text></g>`,
        ),
      }
    case "comparison":
      return {
        height: Math.ceil(count / 2) * 96 + 32,
        marks: marks.map(
          (index) => html`<g>
          <rect data-scene-mark x="${32 + (index % 2) * 144}" y="${16 + Math.floor(index / 2) * 96}" width="112" height="64"/>
          <text x="${88 + (index % 2) * 144}" y="${48 + Math.floor(index / 2) * 96}">${index + 1}</text></g>`,
        ),
      }
    case "timeline":
      return {
        height: count * 64 + 32,
        marks: html`<path d="M64 32 V${count * 64}"/>${marks.map(
          (index) => html`<g>
          <circle data-scene-mark cx="64" cy="${32 + index * 64}" r="24"/>
          <text x="64" y="${32 + index * 64}">${index + 1}</text>
          <path d="M96 ${32 + index * 64} H288"/></g>`,
        )}`,
      }
    case "annotated-process":
      return {
        height: count * 96 + 32,
        marks: html`${marks.map(
          (index) => html`<g>
          <rect data-scene-mark x="96" y="${16 + index * 96}" width="128" height="64"/>
          <text x="160" y="${48 + index * 96}">${index + 1}</text>
          ${index < count - 1 ? html`<path d="M160 ${80 + index * 96} v24 m-8 -8 l8 8 l8 -8"/>` : html``}</g>`,
        )}
          ${scene.loop ? html`<path data-loop-arrow d="M224 ${count * 96 - 48} H272 V48 H232 m8 -8 l-8 8 l8 8"/>` : html``}`,
      }
    case "perspective-3d":
    case "spatial-layers-3d":
      return null
    default:
      return assertNever(scene)
  }
}

export function sceneFigure(scene: SceneSpec, staticOnly = false, ui: ExportUi = "en+ja") {
  if (scene.kind === "perspective-3d" || scene.kind === "spatial-layers-3d")
    return spatialFigure(scene, staticOnly, ui)
  const states = requiredTeachingStates({ ...scene, practice: [] })
  const image = drawing(scene, states.length)
  if (!image) return html``
  return html`<figure class="scene-figure" ${staticOnly ? html`` : html`data-svg-scene="${scene.kind}"`}>
    <svg viewBox="0 0 320 ${image.height}" role="img" aria-labelledby="diagram-title-${scene.id}" aria-describedby="diagram-caption-${scene.id}">
      <title id="diagram-title-${scene.id}">${scene.title.en} / ${scene.title.ja}</title>
      ${image.marks}
    </svg>
    <figcaption id="diagram-caption-${scene.id}">
       <p>${fixedUiBlock("reader.scene.note", ui)}</p>
       ${scene.kind === "annotated-process" && scene.loop ? html`<div data-loop-caption><p>${fixedUiBlock("reader.scene.loop", ui)}</p></div>` : html``}
      <ol class="scene-legend">${states.map((state) => html`<li><a class="pair-label" href="#state-${state.id}">${pairedLabel(state.label)}</a></li>`)}</ol>
    </figcaption>
    ${
      staticOnly
        ? html``
        : html`<fieldset data-scene-controls hidden><legend>${fixedUi("reader.scene.explore", ui)}</legend>
      <div class="scene-actions">
         <button type="button" data-play>${fixedUi("reader.scene.play", ui)}</button>
         <button type="button" data-pause>${fixedUi("reader.scene.pause", ui)}</button>
         <button type="button" data-replay>${fixedUi("reader.scene.replay", ui)}</button>
      </div>
       <label class="scene-seek">${fixedUi("reader.scene.time", ui)}
         <input type="range" min="0" max="${states.length * 1200}" step="1" value="0" data-seek data-value-text-template="${fixedUiText("reader.scene.valueText", ui)}"></label>
       <p data-playback-status role="status" data-static-label="${fixedUiText("reader.scene.static", ui)}" data-playing-label="${fixedUiText("reader.scene.playing", ui)}" data-paused-label="${fixedUiText("reader.scene.paused", ui)}"></p>
      <div class="scene-actions">${states.map((state, index) => html`<button type="button" data-select-state="${state.id}" aria-pressed="false">${index + 1}. <span class="pair-label">${pairedLabel(state.label)}</span></button>`)}</div>
    </fieldset>`
    }
  </figure>`
}
