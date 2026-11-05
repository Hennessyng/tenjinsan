# TEN-29 offline human assessment protocol v2

Version: **TEN29-offline-assessment-2**. New protocol; frozen v1 POLICY, originals,
inventory, answers, labels and freeze records remain untouched. AC3 line86 permits
scripted offline evaluator behavior; AC9 BLOCKED reporting and conditional AC10
NOT RUN do not prevent offline completion. Managed ChatGPT remains the product
route. No live invocation or model judging is authorized by this protocol.

## Roles and prerequisites

The driver authors test fixtures and **provisional intended labels**, not semantic
grades. No AI agent fills human questions, answers, scores, critical flags,
corroboration or adjudication. A later user-named independent HUMAN, who did not
author the originals/candidates/labels, must corroborate labels and assess originals.
The technical reviewer checks integrity only. No assessor is named or approved yet.

All four originals, old answers and earlier candidates were written by/seen by the
same driver. Reversal + definitions are tuning; chronology + mixed are held out
**from tuning, not from this author**. This is not fresh blind held-out evidence,
16 independent books, independent authorship, or proof of real-model understanding.
Four short semantic families remain the semantic denominator. Any prior human
exposure or project-goal knowledge must be disclosed. Old answers are not hidden
fresh questions and are never supplied as independently established answers.

## Frozen sequence (must occur before scored assessment)

1. Hash this policy, rubric and empty form templates. Commit a fresh randomization
   seed by SHA256 **before candidate authorship/materialization**. Retain the seed
   only in author-private evidence. Hash commitment is not a git commit.
2. Author/revise candidates openly before the separate candidate freeze. Retain
   draft failures and reasons; do not choose candidates by human/model scores.
   Freeze candidate bodies, intended-label file and actual persisted outputs with
   hashes before any human scoring. Labels remain UNCONFIRMED until corroborated.
3. D3 supplies **source-only** bundles first: neutral document codes, all four parts
   in order, and blank chapter/question forms. The human independently writes each
   part's material contribution, chapter questions/answers, cross-book questions/
   answers, grounding and uncertainties **before seeing any candidate or map**.
   Record human authorship, time and a hash commitment to this source-only record.
   No machine prefilled questions or answers satisfy this gate.
4. Only after that commitment, unlock candidate maps/synthesis under opaque codes.
   Deterministic order: HMAC-SHA256(seed, domain + private immutable key), sorted
   lexicographically; separate document/order/code domains. Codes must not contain
   family, mutation, intended label, split, filenames, seed or source hashes.
   Engineering IDs/paths and verification explanations must be remapped/omitted
   from assessor content. Literal original text/part order is preserved; procedural
   blinding cannot hide recognizable plots or erase the author's earlier exposure.
5. Run tuning families first. Freeze any openly versioned protocol amendment and
   tuning decisions before unlocking held-out scoring; never tune on chronology/
   mixed scores. If no tuning change occurs, record that explicitly. A held-out
   score cannot justify replacing a failed case or silently updating labels.
6. One scored pass per frozen candidate per human, not best-of-N. Interrupted
   technical delivery may resume only the same unanswered form; a second semantic
   pass is a separately marked repeat/adjudication, never a replacement first pass.

## Human records and acceptance rule

Use all seven anchored dimensions in rubric.json, each0/1/2. Experimental threshold:
at least1 on every dimension and at least12/14 overall. This is not a production
threshold or an automatic semantic judgment. Language applicability is explicit:
score readability in the language actually provided; EN/JA fidelity is assessed
only where bilingual output is supplied/required. Do not invent Japanese output,
award nonexistent translation quality, omit dimension7 or silently prorate14.
Record any applicability dispute for adjudication before an acceptance claim.

For AC4, record **every part**, including supplement: represented faithfully,
appropriately absent from concise synthesis, misrepresented, materially omitted,
or unresolved, with original grounding. Chapter mentions alone are not coverage;
faithful concise controls may omit genuinely immaterial detail. Human chapter
records and source-only answers are distinct from machine processing coverage.

Critical failures override any numeric total: incomplete included-range processing;
material unsupported/overstated/contradicted retained claim; missed seeded late
reversal; unresolved retained citation; unauthorized tools/source/account/model/
destination change; failure to detect a seeded critical evaluator negative.
Mechanical processing/citation checks may establish technical flags only; semantic
flags and whether a seeded negative is genuinely critical require human confirmation.

## Matrix, pipeline and labels

Each family has two intended faithful controls (one concise, omitting an intended
immaterial detail) plus all applicable negatives: correct quote/false conclusion,
omitted exception, invented cross-part relationship, polished early-only summary,
flattened disagreement/perspective and unsupported/overstated claim. An inapplicable
type is explicitly justified, not replaced with invented source disagreement.
These are fixture-author intentions, not independent semantic verdicts.

Substantive maps and synthesis are persisted through the existing v4 pipeline,
with exact original citations. Every run is disposable, separately authorized,
and bounded by its existing fixed capacity/reserve/attempt policy. Never combine
all cases into one grant, increase a cap or truncate/grow an approved plan to fit.
Fixed verification replies may transport-accept every candidate to materialize
it. Mark this **MECHANICAL SCRIPT ACCEPTANCE ONLY**, including for intended negatives;
these replies do not grade or corroborate the candidate. No model judge is called.

## Format equivalence and inheritance (explicit, conditional)

Render/extract all16 documents. Compare the **ordered normalized text**, not raw
file hashes. Canonicalization for this v2 comparison only folds Unicode whitespace
runs to one U+0020 and trims the outside; it never case-folds, composes/decomposes
Unicode, changes punctuation, joins hyphens or removes material characters.
Preserve four logical part boundaries independently of the extractor's blocks.
Retain raw source locations and reversible excerpts for each non-boundary canonical
unit; collapsed whitespace and synthetic block boundaries are explicitly recorded.
The bijection is between canonical-unit positions/ordered logical parts, **not raw
bytes or raw whitespace characters**. Require identical sequences and unique part
coverage; missing, duplicated, reordered, changed scalar/combining text or omission
metadata invalidates inheritance. The exact literal source remains the citation base.

One representative candidate set may be assessed once per semantic family only if
the source equivalence and candidate/citation remapping are proved. Report each
format's mechanical processing separately. A format inherits a semantic result only
when D3's candidate content and per-part citations are bijective too; source-text
equality alone does not authorize inherited scores. Until that proof/human pass,
inheritance is **eligible/pending**, not assessed. Any mismatch gets separate human
assessment with an explicit denominator. Format rows are dependent views of four
families, never16 independent books. Do not rerun model generation per format as
if it were independent calibration.

## Adjudication, disclosure and later deliverables

Retain original intended labels, raw human records and mechanical outcomes. After
blinded first-pass responses are locked, unblind only for corroboration/adjudication.
The named human records agreement/disagreement, original-grounded reason and final
reference label or UNRESOLVED. Never silently rewrite intended labels to improve
rates. Unresolved material disagreements block offline acceptance; report their
denominator explicitly. A single human's reference decisions and rubric scores are
not two independent raters; no inter-rater reliability is claimed.

D3 builds the gated blinded source-first/candidate packet. D4 computes arithmetic
and aggregates only (dummy responses for scorer tests); no human values are present
now. D5 reports offline coverage, calibration pending/completed, readiness BLOCKED,
and live transport/semantics NOT RUN separately. No semantic scores/rates are filled
by this batch. Live readiness is not a prerequisite for finishing these offline
deliverables. Source-only/candidate material stays local and synthetic; any later
external human recipient requires the user's named disclosure permission first.
