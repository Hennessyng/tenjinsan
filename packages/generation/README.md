# Bounded book maps (Task 14)

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
enqueue. Empty blocks fail explicitly rather than being counted as analyzed.
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
