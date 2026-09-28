export const sourceViewerStyles = `
:root {
  color-scheme: light;
  --color-paper: #f5f1e9; --color-paper-raised: #fffdf8;
  --color-ink: #172f2a; --color-green: #27634f; --color-green-soft: #d6e7b8;
  --color-focus: #8a3d27; --color-muted: #63716a; --color-line: #d7dbd1;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-6: 24px; --space-8: 32px; --space-12: 48px;
  --reader-width: 75rem; --reading-width: 46rem; --chapter-width: 14rem;
  --title-size: clamp(2rem, 5vw, 3rem); --heading-size: 1.5rem;
  --body-size: 1rem; --label-size: .75rem; --line-height: 1.8;
  --rule: 1px; --focus-width: 3px;
  background: var(--color-paper); color: var(--color-ink);
  font-family: "Avenir Next", Avenir, "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; padding: var(--space-6); line-height: var(--line-height); font-size: var(--body-size); }
header, main, footer { max-width: var(--reader-width); margin-inline: auto; }
header { display: flex; flex-wrap: wrap; gap: var(--space-6); border-bottom: var(--rule) solid var(--color-line); padding-bottom: var(--space-4); }
main { padding-block: var(--space-8); }
h1 { font: 400 var(--title-size)/1.2 Georgia, serif; margin-block: var(--space-4); }
h2 { font: 400 var(--heading-size)/1.4 Georgia, serif; }
a { color: var(--color-green); text-underline-offset: var(--space-1); }
a:hover { color: var(--color-ink); }
:focus-visible, [autofocus]:focus { outline: var(--focus-width) solid var(--color-focus); outline-offset: var(--space-1); }
.eyebrow { font-size: var(--label-size); letter-spacing: .14em; font-weight: 700; }
.metadata { color: var(--color-muted); }
.reader { display: grid; grid-template-columns: var(--chapter-width) minmax(0, 1fr); gap: var(--space-12); margin-top: var(--space-8); }
article { background: var(--color-paper-raised); padding: var(--space-8); max-width: var(--reading-width); border-top: var(--space-1) solid var(--color-green); }
p, li, dd, code { overflow-wrap: anywhere; }
article p { white-space: pre-wrap; margin-block: var(--space-6); scroll-margin-block: var(--space-8); }
nav ol { padding-left: var(--space-6); }
nav li { margin-bottom: var(--space-3); }
[aria-current="page"] { color: var(--color-ink); font-weight: 700; }
mark { background: var(--color-green-soft); color: var(--color-ink); }
small { display: block; font-size: var(--label-size); color: var(--color-muted); }
details { margin-block: var(--space-4); }
summary { cursor: pointer; }
footer { padding-block: var(--space-6); border-top: var(--rule) solid var(--color-line); }
.setup { max-width: var(--reading-width); margin-inline: auto; }
.setup label { display: block; padding-block: var(--space-2); overflow-wrap: anywhere; }
.setup select, .setup button { font: inherit; max-width: 100%; padding: var(--space-3) var(--space-4); color: var(--color-ink); background: var(--color-paper-raised); border: var(--rule) solid var(--color-line); }
.setup select { width: 100%; }
.setup fieldset { min-width: 0; margin-block: var(--space-6); padding: var(--space-4); border: var(--rule) solid var(--color-line); }
.setup button { cursor: pointer; border-color: var(--color-green); }
.setup button:hover { background: var(--color-green-soft); }
.setup button:disabled { cursor: not-allowed; color: var(--color-muted); border-color: var(--color-line); }
.setup-actions { display: flex; flex-wrap: wrap; gap: var(--space-4); }
.evidence h1 [lang="ja"] { display: block; }
.evidence form { margin-block: var(--space-6); }
.evidence summary { overflow-wrap: anywhere; }
.evidence input:not([type="hidden"]), .evidence textarea {
  display: block; width: 100%; margin-bottom: var(--space-3); padding: var(--space-3);
  font: inherit; color: var(--color-ink); background: var(--color-paper-raised);
  border: var(--rule) solid var(--color-line);
}
@media (max-width: 768px) {
  .reader { grid-template-columns: minmax(0, 1fr); gap: var(--space-6); }
  article { padding: var(--space-4); }
}
`
