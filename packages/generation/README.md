# Whole-book preparation (TEN-26)

Explicit evaluation drafts and managed drafts with a trusted capacity use `whole-book-2`, `batched-room-5` preprocessing and
`batched-original-check-4` verification. Adjacent passages are packed within heading-aware
groups; Unicode-safe parts keep per-block UTF-16 offsets. Extracted headings retain
hierarchy across resource boundaries; unheaded groups are explicitly structural,
not verified author chapters. Empty anchors retain their local identities.

## Verification-room planning policy (`batched-room-5`)

Before consent, every candidate must fit the actual map request and the actual
version-4 omission/finding request builders, including instruction, schema, map
reference metadata, original-source serialization and the existing route envelope.
Both empty envelopes retain at least **12,288 bytes (12 KiB)** below the tighter
of the existing32,000-byte limit and the route certificate. Complete representative
map and finding requests must also pass the trusted input counter with the unchanged
requested output-token reserve. Bytes are never converted into guessed tokens.

This is a versioned, finite **operating sample**, not a generated-output cap or a
worst-case certificate. The reference map is the existing ordinary four-finding
map shape; the reference synthesis batch is six1600-unit ASCII findings from the
existing rich batching fixture. Actual source/citation identity and production-length
application IDs are used in the measured requests. The twelve-KiB floor conservatively
covers the measured medium-book representative batch (roughly11.6kB including finding metadata),
not the much larger escaped schema/transport-admissible adversarial witness.
Changing the floor or reference profile requires another preprocessing version.

The same unchanged two-attempt/job +12-later-work allowance applies. With W windows
and B batches, planned attempts are4W+14+2(W+1)B. At B=1 the64-attempt budget permits
at most8 windows; used attempts, tighter limits or more batches reduce that count.
Smaller windows may therefore refuse larger books before consent. No allowance is
raised, no source is dropped, and B is only reduced before consent to fit the budget.

The signed plan is immutable after Send. New-policy stored windows are re-measured
before cache/enqueue/dispatch; a rehashed policy label on an old packed plan refuses
rather than replanning it. `batched-capacity-4`, v2 and explicitly marked v3 records
keep their original algorithms and cache identities. Fresh policy identity changes
the analysis key, reserve and jobs; old grants cannot silently acquire the new plan.

Actual map/synthesis/verification requests, whole-map omission targets, individual
findings, citation context and actual batch counts still have runtime guards. A richer
map, all-map synthesis or citation set can exceed these samples and stop after counted
work; no output is truncated, silently simplified, or resized to fit. Protocol fixtures
prove metering, source preservation and bindings, not semantic correctness or live readiness.

The retained TEN-26/v2 execution description below explains historical records;
version4 checks the full original windows and finding batches described above.

```
local plan -> explicit Send -> complete chapter-part maps
  -> complete-map book synthesis -> original-context semantic checks
  -> questions -> original-context check -> usable saved bank
```

Every new request needs a trusted application-supplied `VerifiedRouteCapacity` for
the exact provider, model and destination, with a versioned certificate ID, evidence,
verified context/output limits and an input-token counter that includes the request's
instructions, schema and route overhead. Availability and character counts are not
capacity evidence. There is deliberately **no default live-model certificate or
token estimate**: unconfigured routes refuse before saving a grant or dispatching.
The application integration must provide the same certificate to server preparation,
`studySetupSend`, and the production worker. Browser input cannot supply one. Change
its ID when the meter or limits change. Test certificates describe only synthetic
byte-token grammars and do not establish live provider capacity.

Actual full serialization is measured by the selected adapter, without a live call,
before consent and again before every reservation/dispatch, including repairs.
The 32,000-byte ceiling and verified token/output ceilings all apply. Planning includes
two attempts per map, synthesis and verification stage, plus a 12-attempt later-work
reserve for questions, outline and at least one lesson section with their checks.
More lesson sections and generated sizes remain uncertain. Both the generic 64-attempt
setup ceiling and any tighter explicit/shared allowance remain binding; the plan
neither authorizes spending nor promises completion. An overflow refuses rather than
dropping maps, evidence or chapters. There is no smaller-scope substitute.

Rich maps retain purpose, claims where applicable, concepts, definitions, examples,
qualifications, uncertainties and summaries. Explicit no-claim/uncertain/incomplete
results are supported. Synthesis always receives all complete maps and their group
structure; the entire original is added only when that full request fits. Its actual
strategy is stored in the receipt and shown in the existing jobs surface. Mapping,
transmission and semantic support are separate facts, not claims of exhaustiveness.

Semantic stages load authorized original-language passages, neighboring blocks and
qualifications from storage, not paths or summaries alone. Unsupported/overstated/
uncertain verdicts block the new artifact. New question banks, outlines and lessons
also require an exact-receipt-bound support check before becoming usable. Existing
EN/JA approvals, banks and answers are not replaced. These checks use provider verdicts;
synthetic fixtures and valid quotations do not prove live comprehension or translation
quality. TEN-27's introduction, personalization, glossary and live journey are separate.

Persisted partial/completed work is bound to current consent and exact processing
versions. Rich source fragments are verified against the normalization on storage
write and retrieval; source and verification-target substitutions are rejected.
Unsupported versions fail explicitly. No grants or historical receipts are migrated,
rewritten or revived, and unknown outcomes retain the existing explicit retry/stop path.

Synthetic checks: `bunx --no-install vitest run apps/worker/tests/whole-book-*.test.ts
apps/server/src/whole-book-capacity.integration.test.ts`. No private books or live
provider calls are authorized by those fixtures.

## Historical bounded book maps (Task 14 / analysis-1)

The following describes the retained historical implementation, not the new draft
algorithm. Its records remain readable with their original meanings and cache keys.

`BookMapPipeline` accepts an authoritative storage/owner/installation context.
`prepare(setupId, grantId)` validates current consent before looking up an exact
successful cache key, or queues persisted block-window jobs and returns an immutable
partial revision. `stage(job)` plugs into the existing worker's structured provider
stage. Call `prepare` again after work to obtain the completed revision, and pin that
returned ID in downstream records; never ask for another study's "latest" map.

Each analysis window selects at most 12,000 UTF-16 source characters, never another provider's
findings. The final SDK request body must also fit 32,000 UTF-8 bytes before
reservation and dispatch. At most 128 windows are admitted, but no more than 64
attempts per setup across provider and study stages, including repairs, retries
and lesson sections. Each run has a two-call ceiling. Oversized scopes fail explicitly before
enqueue and before normal Send saves a grant. Normal Send also measures each
analysis request through the selected adapter's real serializer, with the same
reviewed-block projection, prompt builder and schema as dispatch. A request over
32,000 bytes is refused before granting with `request-byte-limit` and the entire
reviewed unsent-range inventory. It is not truncated, repartitioned or retried.
Local sizing uses a synthetic credential and never dispatches a provider call.
The planner returns a safe
not-sent reason and full unsent ranges to review. Textless locator/anchor blocks
remain stored but do not become analysis windows; a wholly textless selection
still fails. Retry after a preparation refusal does not encounter a saved grant.
Absolute source offsets are validated against the dispatched window; stored spans
are resolved against the exact normalization. Chapter status remains pending until
all its windows succeed. The synthesis is a deterministic union of source-linked
arguments, concepts and qualifications: it never drops a chapter or compresses away
a counterweight. There is no extra synthesis provider call.

The exact existing cache contract includes edition hash, normalization, ordered
scope and exclusions, provider, model, prompt/schema versions, and every supported
output-affecting setting. The default deployment definition is `analysis-1`
prompt/schema. A trusted application may supply a versioned `BookMapDefinition`
when deploying a revised instruction; versions must match the approved setup.
Never accept that definition from a browser request. Mismatched versions fail
closed rather than silently running the old implementation.
Changing the windowing or synthesis algorithm requires a version bump. Partial
maps are not cache hits. Jobs/receipts use setup, grant, key and window identity,
so process restart resumes existing work without transferring receipts to a new
provider or approval. Unknown transport outcomes retain the existing owner-decision
pause; failed jobs retain their explicit error and need an explicit retry decision.

Verification (no credentials or network):

```sh
bun run test:integration -- book-map
node --experimental-transform-types apps/worker/scripts/book-map-fixture.ts
```

The CLI uses a synthetic two-chapter source and starts a new worker process for
each window, then proves the completed map is reused without another call.
These fixture commands don't make live provider calls. Normal React Send queues
consent-bound analysis through the worker and Vercel AI SDK. Without credentials,
live verification is blocked, not counted as a fixture pass.

## Fixture discovery (Task 15)

`@reading-studio/generation/questions` exports `generateQuestions(input, fixtureOutput)`.
The caller supplies the exact successful analysis and immutable reader context,
plus expected analysis/context/study IDs from its authoritative workflow. This is
a trusted application boundary, not an HTTP endpoint or an ownership check.
No latest-map lookup, database mutation, cloud provider or interview UI is involved.

Fixture output carries paired EN/JA group, lens, option labels and rationales,
learning-goal keys, source spans and source-backed complications. Every citation
must exactly match a finding in the supplied analysis. Invalid output fails before
review, including duplicate IDs and illegal selection bounds. Review collapses
repeated learning-goal keys or normalized labels, records removed IDs and rejects
bounds invalidated by removal rather than silently changing the question contract.
Semantic equivalence beyond the declared goal keys requires content review; this
fixture implementation does not claim model-based semantic deduplication.

The bank retains all distinct lenses; a stable shortlist of at most three prioritizes
the context's preferred learning goals. Custom questions are preserved verbatim,
never silently reframed; each generated choice question also allows custom, unsure
and skip answers under the existing AnswerSubmission contract.

Run `bun run test:integration -- questions` and
`node --experimental-transform-types apps/worker/scripts/questions-fixture.ts`.
These are fixture-only checks, not evidence of live generation quality.

## Fixture themed outlines (Task18)

`@reading-studio/generation/outline` exports an explicitly named fixture provider.
The authenticated server supplies the current approved brief and exact successful
analysis. It creates a question-linked teaching sequence with evidence, learning
goals, visual intentions, retained qualifications and topic exclusions. Choices
reverse the section order or simplify illustrative visuals; custom intentions are
retained verbatim, not translated by a model. Storage validates evidence membership
and retained data before saving, flags invalid question links and unsupported visual
declarations, and requires exact-current approval before downstream section work.

The fixture adapter remains a test utility. The normal worker also has a
provider-backed outline stage with exact approved-brief and source authority.
Loopback wire JSON tests exercise dispatch, not real model quality. The Task18
rubric and DoneClaim describe the earlier fixture milestone.

## Fixture bilingual lessons (Task19)

`@reading-studio/generation/lesson` exports `generateFixtureLesson(storage, request,
fixtureOutput)`. This trusted application boundary takes study, exact outline and
new lesson revision IDs, not caller-authored approval or source records. It requires
current outline and brief approval, retrieves approved spans from local storage,
validates the supplied fixture output and appends an immutable lesson revision.
`workflow.getLesson` reads the result, including teaching metadata after restart.

Every generated section has paired EN/JA copy, attributed teaching blocks, source
metadata with verbatim original-language excerpts, bilingual caveats, practice
labels and answer rationales. Scene specifications retain bilingual labels and
explanations. Illustrative models require explicit bilingual assumptions; a
source-grounded scene must cite the outline's dedicated visual evidence.
The ordered approved sections, learning goals, visual intentions, exclusions and
qualification IDs/source spans are retained. All cited spans must belong to the
approved section or retained qualifications. Fixture output cannot add review
approvals or semantic acknowledgements.

The fixture provider supplies authored output and isn't a live model or a
translation engine. Normal production persists bounded per-section lesson jobs
and receipts, reassembles sections in order and validates the full draft. React
review and evidence routes handle approval; the fixture CLI alone doesn't test
those routes. Run `bunx vitest run
apps/worker/tests/lesson-generation.test.ts apps/worker/tests/lesson-boundaries.test.ts
apps/worker/tests/lesson-cli.test.ts` and `node --experimental-transform-types
apps/worker/scripts/lesson-fixture.ts`. Structural validation cannot certify
semantic support or translation equivalence. Existing legacy lessons may omit
teaching metadata; every Task19 generation requires it.
