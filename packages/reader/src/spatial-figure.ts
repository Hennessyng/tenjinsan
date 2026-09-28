import type { SceneSpec } from "@reading-studio/contracts"
import { html } from "hono/html"
import { pairedLabel, pairedText } from "./primitives.ts"
import { markerPosition, projectedFaces, projectedPoint, spatialBlocks } from "./spatial-model.ts"

type SpatialScene = Extract<SceneSpec, { kind: "perspective-3d" | "spatial-layers-3d" }>

export function spatialFigure(scene: SpatialScene, staticOnly = false) {
  const layers = scene.kind === "spatial-layers-3d" ? scene.layers : []
  const blocks = spatialBlocks(layers.length)
  const labels = layers.length
    ? layers.map((layer) => layer.label)
    : [
        { en: "Near form", ja: "手前の形" },
        { en: "Far form", ja: "奥の形" },
      ]
  return html`<figure class="scene-figure spatial-figure" ${staticOnly ? html`` : html`data-three-scene="${scene.kind}" data-layer-count="${layers.length}"`}>
    ${
      staticOnly
        ? html``
        : html`<div class="spatial-live" hidden><canvas aria-hidden="true"></canvas>
      <svg class="spatial-leaders" viewBox="0 0 320 320" aria-hidden="true">${labels.map(() => html`<line data-leader/>`)}</svg>
      ${labels.map((label, index) => html`<span class="spatial-marker" data-marker="${index}" title="${label.en} / ${label.ja}">${index + 1}</span>`)}
    </div>`
    }
    <figcaption>${pairedText({ en: "Illustrative geometry, not measured evidence. Compare the fixed views; numbers identify forms in the legend.", ja: "測定結果ではなく説明用の図形です。固定視点を比べてください。番号は凡例の形に対応します。" })}
      <ol class="scene-legend">${labels.map((label, index) => html`<li data-object-label="${index}"><span class="pair-label">${pairedLabel(label)}</span></li>`)}</ol>
    </figcaption>
    ${
      staticOnly
        ? html``
        : html`<fieldset data-spatial-controls hidden><legend><span lang="en">Viewpoints and layers</span> / <span lang="ja">視点と層</span></legend>
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
