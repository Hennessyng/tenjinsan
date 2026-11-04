# Frozen experiment v1 (before any generation/scoring)

Four short synthetic semantic families, four format renderings each: 16 documents,
not 16 independent semantic samples. These are diagnostic mini-books, not evidence
of long-book or general semantic reliability. No scored generation in batch 1.

Originals: corpus.json. Independently enumerated expectation artifact: inventory.json.
Answers/controls/split: answers.json; never import it in rendering or generation support.
All authored by the same driver: organizational independence is NOT established.
Inventories are authored separately from extractor output, not computed from it.
The same author will see held-outs; held-out means withheld from tuning, not blind
to this worker. Independent human review remains required before semantic acceptance.
Frozen file SHA-256 values are recorded in freeze.sha256; edits require a new version,
retaining failures, not replacement of failed cases.

Parts in original order: opening, middle, late, supplement. Each has one paragraph.
EPUB: book/1.xhtml..4.xhtml, fourth linear=no/supplementary. DOCX: first three
paragraphs in word/document.xml, fourth in word/footnotes.xml. TXT: all four joined
by LF with no terminal LF, no structural chapter claim. PDF: one part per page;
layout whitespace may collapse to one space, no other text normalization allowed.
Definition table is a literal textual table (DOCX uses a table cell); no inference
about visual table extraction beyond that representation. All baseline text is
supported. Dedicated omission variants add EPUB object content, DOCX unsupported
part and a textless PDF middle page. These are original material losses, not full
original coverage. TXT has no embedded unsupported part.

Bounded known omission is qualified available-text only and needs reviewer
acknowledgement. No acknowledgement is supplied by these tests. Uninventoried,
disputed or material loss blocks acceptance. Empty documents must reject.

Tuning: reversal/definitions. Held-out: chronology/mixed in every format. One scored
run per frozen case; deterministic reruns only diagnose infrastructure and are
reported separately, never best-of-N. No tuning after held-out scoring. Disagreement
is retained as unresolved and blocks acceptance pending an independent reviewer
using whole originals. Failed critical negatives cannot be averaged away. Future
scoring reports false accepts/rejects per family/format and all seven 0–2 dimensions;
at least 1 each and 12/14 is experimental only. Faithful controls may omit incidental
detail. All chapter answers and cross-book context must be inspected. Provider
verdicts are not an independent semantic oracle. No model judging authorized.

Batch 1 checks extraction before ranges. Planned ranges are NOT transmitted or
processed. Transmission/processing/unsent/uncertain will require persisted receipts
in a later batch. Context overlap is not unique coverage. Real product planner is
used; test-only audits are an independent diagnostic, not a new product guard.
