export const readerStyles = `
:root {
  color-scheme: light;
  --color-paper: #f5f1e9; --color-paper-raised: #fffdf8;
  --color-ink: #172f2a; --color-green: #27634f; --color-green-soft: #d6e7b8;
  --color-focus: #8a3d27; --color-muted: #63716a; --color-line: #d7dbd1;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-12: 48px;
  --space-16: 64px; --space-24: 96px;
  --reader-width: 75rem; --reading-width: 46rem; --chapter-width: 14rem;
  --display-size: clamp(3rem, 8vw, 6.5rem); --title-size: clamp(2rem, 5vw, 3rem);
  --heading-size: 1.5rem; --body-size: 1rem; --label-size: .75rem;
  --ja-lead-size: clamp(1.25rem, 3vw, 2rem); --line-height: 1.8;
  --rule: 1px; --focus-width: 3px;
  --font-body: "Avenir Next", Avenir, "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans CJK JP", sans-serif;
  --font-display: Georgia, "Times New Roman", serif;
  --font-ja: "Hiragino Mincho ProN", "Yu Mincho", YuMincho, serif;
  background: var(--color-paper); color: var(--color-ink); font-family: var(--font-body);
}
* { box-sizing: border-box; }
body { margin: 0; padding: var(--space-5); font-size: var(--body-size); line-height: var(--line-height); }
.editorial { max-width: var(--reader-width); margin-inline: auto; }
a { color: var(--color-green); text-underline-offset: var(--space-1); }
a:not(.pair-label) { display: inline-flex; flex-wrap: wrap; gap: var(--space-2); }
a:hover { color: var(--color-ink); }
:focus-visible { outline: var(--focus-width) solid var(--color-focus); outline-offset: var(--space-1); }
[tabindex="-1"] { scroll-margin-block: var(--space-8); }
:target { outline: var(--rule) solid var(--color-green); outline-offset: var(--space-2); }
.masthead { display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4); padding-block: var(--space-4); border-bottom: var(--rule) solid var(--color-line); }
.eyebrow { font-size: var(--label-size); font-weight: 700; letter-spacing: .14em; }
h1, h2, h3, h4, p { margin: 0; overflow-wrap: anywhere; }
h1, h2 { font-family: var(--font-display); font-weight: 400; }
h1 { font-size: var(--display-size); line-height: .98; letter-spacing: -.045em; max-width: var(--reading-width); padding-block: var(--space-12); }
h1 [lang="ja"] { font-size: var(--ja-lead-size); line-height: 1.75; letter-spacing: .035em; margin-top: var(--space-6); }
h2 { font-size: var(--title-size); line-height: 1.4; margin-bottom: var(--space-8); }
h3 { font-size: var(--heading-size); line-height: 1.4; }
h4 { font-size: var(--body-size); }
h1 [lang="ja"], h2 [lang="ja"] { font-family: var(--font-ja); }
[lang="ja"] { word-break: normal; line-break: strict; }
.pair-label > span { display: block; }
.pair-label > [lang="ja"] { line-height: var(--line-height); }
.pair-label > [lang="ja"] { text-wrap: balance; overflow-wrap: normal; word-break: auto-phrase; }
.pair { display: grid; gap: var(--space-4); }
.pair p { white-space: pre-wrap; }
.language-controls { display: flex; flex-wrap: wrap; gap: var(--space-3); border: 0; border-block: var(--rule) solid var(--color-line); margin: 0; padding: var(--space-4) 0; }
.language-controls label { cursor: pointer; padding: var(--space-2) var(--space-3); border: var(--rule) solid var(--color-line); }
.language-controls label:has(:checked) { background: var(--color-green-soft); border-color: var(--color-green); }
.language-controls label:focus-within { outline: var(--focus-width) solid var(--color-focus); outline-offset: var(--space-1); }
input { accent-color: var(--color-green); }
.reader-grid { display: grid; gap: var(--space-8); padding-block: var(--space-8); }
.contents ol { padding-left: var(--space-6); }
.contents li { margin-block: var(--space-4); }
.contents h2 { font-size: var(--heading-size); margin-bottom: var(--space-4); }
.chapters { min-width: 0; }
.chapter { padding: var(--space-5); margin-bottom: var(--space-12); background: var(--color-paper-raised); border-top: var(--space-1) solid var(--color-green); }
.chapter > .eyebrow { margin-bottom: var(--space-4); }
.scene, .practice, .sources { margin-top: var(--space-12); }
.scene > h3, .practice > h3 { margin-bottom: var(--space-4); }
.states { list-style: none; padding: 0; margin: var(--space-6) 0; }
.states > li { padding-block: var(--space-6); border-top: var(--rule) solid var(--color-line); }
.states h4 { margin-bottom: var(--space-3); }
.caption { margin-top: var(--space-4); border-left: var(--space-1) solid var(--color-green-soft); padding-left: var(--space-4); }
.sources { border-top: var(--rule) solid var(--color-line); padding-top: var(--space-6); }
.sources ol { padding-left: var(--space-6); }
.sources li { margin-block: var(--space-6); }
.locator { overflow-wrap: anywhere; font-size: var(--label-size); }
blockquote { margin: var(--space-4) 0; border-left: var(--space-1) solid var(--color-line); padding-left: var(--space-4); white-space: pre-wrap; overflow-wrap: anywhere; }
.chapter-nav { display: flex; flex-wrap: wrap; gap: var(--space-6); margin-top: var(--space-8); }
footer { border-top: var(--rule) solid var(--color-line); padding-block: var(--space-6); }
.editorial:has(input[value="en"]:checked) .reading-content [lang="ja"],
.editorial:has(input[value="ja"]:checked) .reading-content [lang="en"] { display: none; }
@media (min-width: 768px) {
  body { padding: var(--space-8); }
  .chapter { padding: var(--space-8); }
}
@media (min-width: 1280px) {
  .reader-grid { grid-template-columns: var(--chapter-width) minmax(0, 1fr); gap: var(--space-12); }
  .pair { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-8); }
  .editorial:has(input[value="en"]:checked) .pair,
  .editorial:has(input[value="ja"]:checked) .pair { grid-template-columns: minmax(0, 1fr); }
}
@media print {
  .editorial .reading-content [lang] { display: block !important; }
  .language-controls, .chapter-nav { display: none; }
  .reader-grid { display: block; }
}
`
