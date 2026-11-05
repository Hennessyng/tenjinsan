# Offline PDF extraction internals

Public EmbedPDF WASM APIs only. These modules run in the fixed local PDF child, not in the application process. Missing targets are probed in fresh page copies with bounded per-page work; unexplained pages are excluded. No source instructions are executed.
