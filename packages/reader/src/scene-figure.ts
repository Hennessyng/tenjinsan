import { assertNever, requiredTeachingStates, type SceneSpec } from "@reading-studio/contracts"
import { html } from "hono/html"
import { pairedLabel, pairedText } from "./primitives.ts"
import { spatialFigure } from "./spatial-figure.ts"

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

export function sceneFigure(scene: SceneSpec, staticOnly = false) {
  if (scene.kind === "perspective-3d" || scene.kind === "spatial-layers-3d")
    return spatialFigure(scene, staticOnly)
  const states = requiredTeachingStates({ ...scene, practice: [] })
  const image = drawing(scene, states.length)
  if (!image) return html``
  return html`<figure class="scene-figure" ${staticOnly ? html`` : html`data-svg-scene="${scene.kind}"`}>
    <svg viewBox="0 0 320 ${image.height}" role="img" aria-labelledby="diagram-title-${scene.id}" aria-describedby="diagram-caption-${scene.id}">
      <title id="diagram-title-${scene.id}">${scene.title.en} / ${scene.title.ja}</title>
      ${image.marks}
    </svg>
    <figcaption id="diagram-caption-${scene.id}">
      ${pairedText({ en: "Illustrative model. Numbers refer to the explanations below.", ja: "説明のためのモデルです。番号は下の解説に対応します。" })}
      ${scene.kind === "annotated-process" && scene.loop ? html`<div data-loop-caption>${pairedText({ en: "The return arrow connects the last step to the first: the process can repeat.", ja: "戻り矢印は最後の段階と最初の段階を結び、このプロセスを繰り返せることを示します。" })}</div>` : html``}
      <ol class="scene-legend">${states.map((state) => html`<li><a class="pair-label" href="#state-${state.id}">${pairedLabel(state.label)}</a></li>`)}</ol>
    </figcaption>
    ${
      staticOnly
        ? html``
        : html`<fieldset data-scene-controls hidden><legend><span lang="en">Explore the scene</span> / <span lang="ja">図解を操作</span></legend>
      <div class="scene-actions">
        <button type="button" data-play><span lang="en">Play</span> / <span lang="ja">再生</span></button>
        <button type="button" data-pause><span lang="en">Pause</span> / <span lang="ja">一時停止</span></button>
        <button type="button" data-replay><span lang="en">Replay</span> / <span lang="ja">最初から再生</span></button>
      </div>
      <label class="scene-seek"><span lang="en">Scene time (milliseconds)</span> / <span lang="ja">図解の時間（ミリ秒）</span>
        <input type="range" min="0" max="${states.length * 1200}" step="1" value="0" data-seek></label>
      <p data-playback-status role="status"></p>
      <div class="scene-actions">${states.map((state, index) => html`<button type="button" data-select-state="${state.id}" aria-pressed="false">${index + 1}. <span class="pair-label">${pairedLabel(state.label)}</span></button>`)}</div>
    </fieldset>`
    }
  </figure>`
}
