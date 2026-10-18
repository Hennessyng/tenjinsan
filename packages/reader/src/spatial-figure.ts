import type { ExportUi, SceneSpec } from "@reading-studio/contracts"
import { translate } from "@reading-studio/contracts/i18n"
import { html } from "hono/html"
import { pairedLabel, pairedText } from "./primitives.ts"
import { markerPosition, projectedFaces, projectedPoint, spatialBlocks } from "./spatial-model.ts"
import { fixedUi, fixedUiBlock, fixedUiText } from "./ui.ts"

type SpatialScene = Extract<SceneSpec, { kind: "perspective-3d" | "spatial-layers-3d" }>

export function spatialFigure(scene: SpatialScene, staticOnly = false, ui: ExportUi = "en+ja") {
  const layers = scene.kind === "spatial-layers-3d" ? scene.layers : []
  const blocks = spatialBlocks(layers.length)
  const labels = layers.length
    ? layers.map((layer) => layer.label)
    : [
        { en: translate("en", "reader.spatial.near"), ja: translate("ja", "reader.spatial.near") },
        { en: translate("en", "reader.spatial.far"), ja: translate("ja", "reader.spatial.far") },
      ]
  return html`<figure class="scene-figure spatial-figure" ${staticOnly ? html`` : html`data-three-scene="${scene.kind}" data-layer-count="${layers.length}"`}>
    ${
      staticOnly
        ? html``
        : html`<div class="spatial-live" hidden><canvas aria-hidden="true"></canvas>
      <svg class="spatial-leaders" viewBox="0 0 320 320" aria-hidden="true">${labels.map(() => html`<line data-leader/>`)}</svg>
       ${labels.map((label, index) => html`<span class="spatial-marker" data-marker="${index}" title="${layers.length ? `${label.en} / ${label.ja}` : fixedUiText(index === 0 ? "reader.spatial.near" : "reader.spatial.far", ui)}">${index + 1}</span>`)}
    </div>`
    }
    <figcaption><p>${fixedUiBlock("reader.spatial.note", ui)}</p>
      <ol class="scene-legend">${labels.map((label, index) => html`<li data-object-label="${index}">${layers.length ? html`<span class="pair-label">${pairedLabel(label)}</span>` : fixedUi(index === 0 ? "reader.spatial.near" : "reader.spatial.far", ui)}</li>`)}</ol>
    </figcaption>
    ${
      staticOnly
        ? html``
        : html`<fieldset data-spatial-controls hidden><legend>${fixedUi("reader.spatial.controls", ui)}</legend>
      <div class="scene-actions">${scene.viewpoints.map((view, index) => html`<button type="button" data-view="${scene.id}:viewpoint:${view.id}" data-view-index="${index}" aria-pressed="false"><span class="pair-label">${pairedLabel(view.label)}</span></button>`)}</div>
      <div class="scene-actions">${layers.map((layer, index) => html`<button type="button" data-layer="${scene.id}:layer:${layer.id}" data-layer-index="${index}" aria-pressed="false">${index + 1}. <span class="pair-label">${pairedLabel(layer.label)}</span></button>`)}</div>
      <p class="pair-label" data-spatial-status role="status"><span lang="en"></span><span lang="ja"></span></p>
    </fieldset>`
    }
    <div class="spatial-alternatives">${scene.viewpoints.map(
      (view, index) => html`<figure data-static-view="${scene.id}:viewpoint:${view.id}">
      <svg viewBox="0 0 320 320" role="img" aria-labelledby="static-${scene.id}-${view.id}">
        <title id="static-${scene.id}-${view.id}">${view.label.en} / ${view.label.ja}</title>
        ${blocks
          .map((block, object) => ({
            block,
            object,
            depth: projectedPoint(block.center, index).depth,
          }))
          .sort((a, b) => b.depth - a.depth)
          .map(
            ({ block, object }) =>
              html`<g data-static-object="${object}" data-tone="${object % 2}">${projectedFaces(block, index).map((points) => html`<polygon points="${points}"/>`)}</g>`,
          )}
        ${blocks.map((block, object) => {
          const point = projectedPoint(block.center, index)
          const marker = markerPosition(object, blocks.length)
          return html`<g><line x1="${marker.x}" y1="${marker.y}" x2="${point.x}" y2="${point.y}"/><circle cx="${marker.x}" cy="${marker.y}" r="12"/><text x="${marker.x}" y="${marker.y}">${object + 1}</text></g>`
        })}
      </svg><figcaption><h4 class="pair-label">${pairedLabel(view.label)}</h4>${pairedText(view.explanation)}</figcaption>
    </figure>`,
    )}</div>
  </figure>`
}
