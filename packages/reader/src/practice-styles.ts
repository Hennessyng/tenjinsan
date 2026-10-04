export const practiceStyles = `
.practice > .pair, .practice > .eyebrow { margin-bottom: var(--space-4); }
.practice h3 span { text-wrap: balance; }
.practice-choices { min-width: 0; margin: var(--space-6) 0; padding: 0; border: 0; }
.practice-choices legend { margin-bottom: var(--space-3); }
.practice-option { border-top: var(--rule) solid var(--color-line); padding-block: var(--space-4); }
.practice-option label { display: block; padding: var(--space-3); cursor: pointer; }
.practice-option label:has(:checked) { background: var(--color-green-soft); }
.practice-option label:focus-within { outline: var(--focus-width) solid var(--color-focus); }
.practice-feedback { padding: var(--space-4); border-left: var(--space-1) solid var(--color-green-soft); }
.practice-feedback .pair { margin-top: var(--space-3); }
.practice-choices:has(:checked) .practice-option:not(:has(:checked)) .practice-feedback { display: none; }
.practice textarea { width: 100%; max-width: 100%; padding: var(--space-3); font: inherit; color: inherit; background: var(--color-paper-raised); border: var(--rule) solid var(--color-line); }
.practice > a { margin-top: var(--space-4); }
#book-map li { padding-block: var(--space-4); border-top: var(--rule) solid var(--color-line); }
@media print { .practice .practice-feedback { display: block !important; } .practice textarea { display: none; } }
`
