export const spatialStyles = `
:root { --color-coral: #d88869; }
.spatial-live { position: relative; width: min(100%, var(--scene-width)); aspect-ratio: 1; margin: auto; }
.spatial-live canvas { display: block; width: 100%; height: 100%; }
.scene-figure .spatial-leaders { position: absolute; inset: 0; margin: 0; width: 100%; height: 100%; pointer-events: none; }
.spatial-figure svg line { stroke: var(--color-ink); stroke-width: var(--rule); }
.spatial-marker { position: absolute; transform: translate(-50%, -50%); background: var(--color-paper); color: var(--color-ink); border: var(--rule) solid var(--color-green); padding-inline: var(--space-1); font: var(--body-size) var(--font-body); }
[data-spatial-controls] { margin-block: var(--space-6); padding: var(--space-4); border: var(--rule) solid var(--color-line); min-width: 0; }
[data-spatial-controls] .scene-actions + .scene-actions { margin-top: var(--space-4); }
.spatial-alternatives > figure { margin: var(--space-6) 0; break-inside: avoid; }
.spatial-alternatives polygon { fill: var(--color-green-soft); stroke: var(--color-green); stroke-width: var(--rule); }
.spatial-alternatives [data-tone="1"] polygon { fill: var(--color-coral); }
.spatial-alternatives svg circle { fill: var(--color-paper); }
@media print {
  .spatial-live, [data-spatial-controls] { display: none !important; }
  .spatial-alternatives, .spatial-alternatives > figure { display: block !important; }
}
`
