export const sceneStyles = `
:root { --scene-width: 20rem; }
.scene-figure { margin: var(--space-6) 0; }
.scene-figure svg { display: block; width: min(100%, var(--scene-width)); height: auto; margin: 0 auto var(--space-6); overflow: visible; }
.scene-figure svg rect, .scene-figure svg circle { fill: var(--color-green-soft); stroke: var(--color-green); stroke-width: var(--rule); }
.scene-figure svg path { fill: none; stroke: var(--color-green); stroke-width: var(--rule); }
.scene-figure svg text { fill: var(--color-ink); text-anchor: middle; dominant-baseline: central; font: var(--body-size) var(--font-body); }
.scene-legend { padding-left: var(--space-6); }
.scene-legend li { padding-block: var(--space-2); }
[data-scene-controls] { margin: var(--space-6) 0; padding: var(--space-4); border: var(--rule) solid var(--color-line); min-width: 0; }
.scene-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.scene-actions button { max-width: 100%; font: inherit; color: var(--color-ink); background: var(--color-paper); border: var(--rule) solid var(--color-green); padding: var(--space-2) var(--space-3); cursor: pointer; overflow-wrap: anywhere; text-align: start; }
.scene-actions button:hover:not(:disabled), .scene-actions button[aria-pressed=true] { background: var(--color-green-soft); }
.scene-actions button[aria-pressed=true] { border-width: var(--focus-width); }
.scene-actions button:disabled { color: var(--color-muted); border-color: var(--color-line); cursor: default; }
.scene-seek { display: block; margin-block: var(--space-4); }
.scene-seek input { display: block; width: 100%; margin: var(--space-2) 0; }
[data-playback-status] { margin-block: var(--space-3); }
@media print {
  [data-scene-controls] { display: none; }
  [data-scene-mark] { opacity: 1 !important; }
}
@media (prefers-reduced-motion: reduce) { [data-scene-mark] { opacity: 1 !important; } }
`
