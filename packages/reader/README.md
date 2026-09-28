# Bilingual editorial reader (Tasks21–24)

`readerDocument(input)` parses a strict `PublicationProjection` and returns trusted,
escaped Hono markup. It never interprets lesson text as HTML, CSS, URLs or scripts.
Only developer-owned styles and the fixed scene runtime use `raw`. Missing/blank languages reject at
the boundary instead of producing empty panels.

The document contains every canonical teaching state, both languages, all scene
and section practice prompts/options/feedback, captions, source notes and asset
descriptions. Practice is explanatory, not scored. Source locators are plain text;
navigation links target local sections and notes. No source-book or asset payload
is fetched. The renderer accepts the allowlisted projection, not private workflow
objects.

Native radios select paired, English or Japanese reading through CSS. They work
without JavaScript, do not persist a preference, and never remove text from the
document. Print restores both languages.

Task22 adds reusable trusted SVG renderers for layered diagrams, comparisons,
timelines and annotated processes (including loop arrows). Numbered shapes link
to complete bilingual teaching notes. Every scene declares `data-print-states`
directly from `requiredTeachingStates`, including practice feedback.

Each enhanced figure shares one finite clock across its WAAPI shape tracks:
1200ms per conceptual state. Native Play/Pause/Replay buttons, a seek range and
state-selection buttons work with the keyboard. Seeking pauses; no scene autoplays.
Off-screen/document-hidden scenes pause without automatic resumption. Reduced
motion, printing and missing WAAPI retain all information without playback.
Removing a figure releases its animations, observers and event handlers.

`scene-script.ts` loads a fixed developer-owned browser TypeScript file and strips
types with Node's built-in API. It never incorporates lesson strings. Keeping the
browser file outside the server import graph avoids leaking DOM global types into
Node services. Only this trusted script and the trusted styles use `raw`; lesson
strings still pass through escaped templates.

The authenticated studio exposes the current private reading copy through
`/evidence/:study/:lesson/read`; evidence review links to it. Existing owner,
lineage and no-store policies apply. Only the reading route allows the exact
SHA-256 hash of the trusted runtime; evidence/preview routes retain no-script CSP.
Reading does not approve or publish.

Verification: `bunx vitest run packages/reader/tests`, `bun run test:e2e -- reader`.
The `./testing` export provides synthetic fixtures and an ephemeral local HTTP
server for browser tests; it is not a production route. Two lessons cover all six
scene kinds; the primitive harness covers long Japanese and hostile literal text.
Evidence lives under `.omo/evidence/reading-studio/task-21/`.

Task22: `bun run test:e2e -- scenes reader evidence`. The synthetic `/scenes`
fixture exercises five diagrams with three conceptual states each; captures at
375/768/1280px include exact clock positions 0/1100/1200/3600ms. Its evidence is
under `.omo/evidence/reading-studio/task-22/`.

Task23 adds locally bundled Three.js for perspective comparison and spatial layers.
Only documents containing those kinds include the bundle. All geometry, materials,
camera positions, clipping planes and pixel-ratio limits are developer-owned;
strict scene contracts do not accept code, shaders, camera parameters or remote
assets. Up to 12 viewpoints/layers enhance; larger content remains static.

Four fixed camera orientations repeat in authored viewpoint order: front, side,
above and oblique. Each viewpoint has a server-rendered SVG alternative and its
supplied bilingual explanation. Numbered leader lines identify every form/layer,
including forms occluded from a particular view. The full legend and every static
view remain available with WebGL/JavaScript disabled and in print. These are
illustrative models, not source-derived physical measurements.

Native buttons select viewpoints and emphasize layers with immediate changes.
No animation loop, auto-orbit, tween or inertia runs, including reduced motion.
Rendering is on demand and suspended off-screen, while hidden and during print.
Removing the figure, losing its WebGL context, or leaving the page disposes
geometries, materials, renderer/context, observers and per-figure listeners.
Persisted page return rebuilds a fresh canvas instead of reusing a lost context.

`spatial-script.ts` bundles the installed dependency once at process startup using
esbuild; no model content enters this build. The authenticated reader permits only
the exact hashes of both trusted scripts. Other evidence routes remain script-free.
No export or publication pipeline is added.

Verify with `bun run test:e2e -- spatial scenes reader evidence --workers=2`.
Independent fixture content in `tests/spatial-fixture.ts` enumerates four viewpoints,
three layers and all required bilingual labels without importing renderer presets
or state enumerators. Task23 evidence is under `.omo/evidence/reading-studio/task-23/`.

Task24 adds native radio choices for reply practice, topic question cards and
personal reflection. Optional `kind`, `scenario` and `attribution` metadata retain
legacy exercises; unspecified kinds use fictional reply practice. Every option
requires bilingual authored feedback. Feedback is attributed to the lesson author
by default, never represented as a quotation or a score. Supplied attribution text
is subject to the existing meaning/privacy review, not machine certification.

All explanations are initially present. Selecting a choice shows its explanation;
choosing another permits comparison. Print restores every explanation. Reflection
also offers an optional textarea with an explicit page-only/not-saved notice.
There is no submission, storage, provider request, preference-intake write or
personal-answer grading. Native controls and CSS work without scripts.

The optional `bookMap` projection inventory has validated lesson section links.
New evidence projections derive main-chapter inventory from the stored source
normalizations and mark coverage by section source use. Excluded or unused chapters
remain not covered. This is lesson coverage, not a claim of complete chapter
treatment or analysis coverage. Older projections without inventory explicitly
say whole-book coverage is not established. Chapter labels retain resource paths
when the normalization has no display-title metadata.

Run `bun run test:e2e -- practice --workers=2` for all seven independent fixture
option/feedback pairs, source context, coverage, custom reflection and no-script/
print checks at 375/768/1280px. Evidence: `.omo/evidence/reading-studio/task-24/`.
