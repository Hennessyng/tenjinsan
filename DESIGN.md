# Question-led Reading Studio Design System

## 0. Research Log

- Embedded reference: the protected local `how to know a person-summary.html` plus the routed editorial-minimalist rules supplied the palette, type pairing, open composition, focus treatment, and bilingual rhythm.
- External screen research: skipped because the user designated the standalone local HTML as the only visual reference.
- Generated drafts: skipped because this task is a technical shell with a precise supplied reference, not a new visual concept.
- Implementation references: strict design-system architecture, minimalist execution, performance, designpowers review, Playwright, and visual QA guidance were read before UI work.

## 1. Atmosphere & Identity

A quiet personal worktable rather than a dashboard. Warm paper carries dark ink, with green for considered structure and coral for human attention. The signature is the bilingual reading pair: English establishes the main rhythm while Japanese sits beside it as equal meaning, never decorative translation.

## 2. Color

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Paper | `--color-paper` | `#f5f1e9` | Page canvas |
| Paper raised | `--color-paper-raised` | `#fffdf8` | Quiet content surface |
| Ink | `--color-ink` | `#172f2a` | Primary text and line art |
| Green | `--color-green` | `#27634f` | Structural accent and primary link |
| Green soft | `--color-green-soft` | `#d6e7b8` | Selection and restrained emphasis |
| Coral | `--color-coral` | `#d88869` | Human accent and focus ring |
| Focus coral | `--color-focus` | `#8a3d27` | Keyboard focus against paper |
| Muted | `--color-muted` | `#63716a` | Secondary text |
| Line | `--color-line` | `#d7dbd1` | Dividers and quiet outlines |

The page stays light-only at bootstrap. Green and coral are sparse signals, not large decorative fills. All foreground/background combinations target WCAG 2.2 AA.

## 3. Typography

English display text uses the offline-safe editorial stack `Georgia, "Times New Roman", serif`. Japanese display text uses `"Hiragino Mincho ProN", "Yu Mincho", YuMincho, serif`. Interface and body text use `"Avenir Next", Avenir, "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans CJK JP", sans-serif`. No font is fetched at runtime.

| Level | Size | Weight | Line height | Tracking | Usage |
| --- | --- | --- | --- | --- | --- |
| Display | `clamp(3rem, 8vw, 6.5rem)` | 400 | 0.98 | `-0.045em` | English title |
| Japanese lead | `clamp(1.25rem, 3vw, 2rem)` | 400 | 1.75 | `0.035em` | Paired title cue |
| Body large | `1.125rem` | 400 | 1.65 | normal | English introduction |
| Body | `1rem` | 400 | 1.8 | normal | Supporting copy |
| Label | `0.75rem` | 700 | 1.4 | `0.14em` | Small section identity |

Japanese content must use `lang="ja"`, normal word breaking, and sufficient line height for kana and kanji. English and Japanese remain separately selectable text.

## 4. Spacing & Layout

Spacing follows a 4px base: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-6` 24px, `--space-8` 32px, `--space-12` 48px, `--space-16` 64px, and `--space-24` 96px.

- `390px`: one reading column, 20px side gutters, illustration after copy, no horizontal overflow.
- `768px`: two balanced columns where space permits, 32px gutters, paired language remains adjacent by reading order.
- `1280px`: asymmetric editorial grid within a 1200px maximum, with generous negative space around the title.
- Static content comes first in source order. Layout enhancement never changes reading order.

## 5. Components

### Interface language (TEN-19)

- App chrome uses one accepted English/Japanese preference; saved questions, original passages, generated bilingual teaching content and license bodies retain their language and wording. Lesson-language radios remain independent of interface language.
- The header language selector uses native buttons in a labelled fieldset, visible pressed states, existing paper/ink/line tokens and existing focus rings. Space-1 separates buttons; space-2/space-3 pad controls. At narrow widths it stays beside the brand without overflow. Selection uses a paper wash, not an accent edge. No new token or motion.
- Unsaved app edits and private-reader reflection text require the existing Stay/Leave decision before language or storage changes. Storage failures use a wrapping status notice and never claim persistence.
- Departure dialogs are centered raised-paper surfaces with space-6 padding, a neutral line rule, existing focus rings and a dimmed ink backdrop. Native actions use existing button styles, wrap with space-3 gaps, and keep at least 32px target height; no motion or new color token is introduced.
- New files fix interface language to English, Japanese or both at Publish, defaulting to English independently of the app. Their fixed interface spans remain visible when CSS-only lesson radios change; print retains both authored lesson languages. Only the private reader includes the trusted preference bridge.
- Paired interface paragraphs place each locale on its own block to avoid Japanese sentence-ending orphans after long English text. Compact headings and controls retain inline language separation. No hidden separator text is emitted into print/PDF readiness inventories.
- Keyboard and CJK constraints: each choice is focusable and named; Japanese labels wrap naturally; explicit language spans identify mixed-language choice names. No content is hidden to accommodate narrow headers. Visual review remains a separate gate.
- Accepted explicit back/forward URL language is applied only after the unsaved-navigation capture guard. Blocked/reversal history events do not change the language or remembered choice. Edition history names the captured file interface, including an explicit unrecorded legacy state; fixed reader descriptions and scene accessible time values use that reader's catalog choice, not app preference.

### Open library access (authentication removal)

- The existing hall and desk open without login, logout, session-expiry gates or login-triggered animation, locally and when hosted. Anyone reaching the server can access the library; “owner” now means its persisted data namespace, not an authenticated visitor.
- Keep existing tokens, layout, keyboard navigation and all authoring/review workflows. Host/origin checks, body limits, resource integrity, private-file URL isolation and worker boundaries remain. Legacy login links return to the hall; no credential fields or authentication cookies are created.

### Accession intake (TEN-6)

- TEN-22 combines intake, existing sources and reading in numbered room 1, with the existing paper, native links and desk scroll owner. Later responsibilities retain their order, numbered 2–9; old import/source and stacks-inspection URLs remain usable. A retained receipt offers an explicit reading link. Switching another selected study requires native confirmation; failure retains the receipt/link with a sanitized alert. Duplicate imports keep the current matching study, otherwise choosing the lowest stable study ID. Only one source-open request runs at once; leaving cancels it. While reading, a native details disclosure keeps intake and the receipt accessible without displacing the passage. Successful import focuses its receipt without resetting the active reader. No new visual tokens or motion.
- Standalone TEN-22: at viewport heights up to 500px, only this combined room uses `#desk-body` as its single scroll owner. Header, content and footer flow together so complete controls/passages fit in the scroll port; the room-navigation rail remains outside it. Chapter navigation precedes the passage in one column rather than squeezing it beside a rail inside the desk. Other rooms and desktop widths retain the existing layout. No new spacing, color or motion tokens.

- TEN-18 reuses the native chooser, stamps, details and paper surfaces for EPUB, DOCX, TXT and PDF. Show persisted readiness separately from a retained queued receipt. Coverage details name extraction omissions and real format locations; no invented pages. Send review distinguishes extracted text, transmission limits and unverified original-file capability. No new tokens or motion.
- Preparation refusal reuses the setup paper and native alert/focus behavior. Name the safe window limit, state that no grant/text was sent, list every unsent located range, and retain Revise/Send controls. Long range inventories use the existing desk scroll owner; no new token or motion.

- The existing native EPUB chooser and submit action sit inside a raised-paper accession sheet and dashed intake tray. A private-import margin note sits beside the sheet when wide and follows it below at narrow widths; document scroll remains the only scroll owner.
- Actual upload outcomes use text-bearing stamps. Accepted receipts say Queued, retain the real receipt ID and byte count, and explicitly say Not yet readable. A later refusal is the current alert while any retained receipt is labelled Earlier acceptance.
- Only committed pending receipts receive the intake-status paper on the source list. Queued and Not yet readable remain separate visible stamps; normalized source and reader presentation is unchanged.
- Reuse paper, raised paper, ink, green, green-soft, line, muted, focus, display/body type and 4px spacing tokens. Native chooser semantics, upload rules, refusal copy, keyboard focus and provider-transmission boundaries remain unchanged.

### Static print composition (Task26)

- A separate, script-free document is composed from an authoritative approved publication revision, never a browser snapshot. Reuse paired text, teaching-state lists, diagram geometry, source notes and existing reader tokens. Maximum width is `--reading-width`; bilingual paragraphs stack for predictable paper reading order.
- All scene states appear as annotated sequences or alternatives, including every fixed spatial viewpoint and layer. Controls, canvas, playback state and local learner answers are absent. All authored practice options and feedback remain expanded.
- The curated question collection contains only approved topic-practice prompts and options, with their feedback; it does not invent questions or import the private interview bank. Sources form a separate appendix with locators, quotations and commentary.
- Print starts lesson sections and appendices on new pages, keeps headings with subsequent content, and avoids splitting figures, teaching items and quotations when they fit. This is composition, not PDF pagination certification (Task27).
- Readiness compares real DOM labels, explanations, alternatives and source/question content with trusted variant rules and approved arrays. Declared state manifests alone never establish readiness. Verify 375/768/1280px, print media, changed preview selections and scripts disabled.

### Learner practice and book map (Task24)

- Reuse paired headings/text, reader paper, green rules, native choice labels, spacing and focus tokens. Reply, topic and reflection cards are learner activities, never preference-intake forms. No animation or new visual tokens.
- Native radio choices highlight their corresponding authored explanation; all explanations are available initially and in print. Feedback carries lesson-author attribution and a section source-context link. Reply scenarios are explicitly fictional; no score or prediction of a real person's response is produced.
- Task25 standalone copies keep every authored explanation visible after any choice, including with JavaScript or WebGL disabled; selection still highlights the native choice without concealing fallback teaching content.
- Reflection offers authored choices plus a separate optional local textarea. Text is not submitted, saved or assessed. No form action, analytics or persistence is added.
- The book map lists each supplied chapter with Covered in this lesson or Not covered in this lesson. Covered means linked source material is used, not exhaustive treatment. Links lead to the relevant lesson sections; missing inventories say coverage is unavailable, never imply complete coverage.
- Keyboard-only, bilingual, script-disabled and narrow-screen readers use the same native controls at 375/768/1280px. Labels wrap, focus is visible, and print exposes all explanations. Source and authored text remain escaped.

### Selective spatial scenes (Task23)

- Reuse scene controls, paired labels, paper/green/coral/ink tokens and the 320-unit drawing grid. A square live viewport sits above a numbered, wrapping bilingual legend. Print and fallback use supplied, server-rendered SVG alternatives for every canonical viewpoint, with every layer labelled. No canvas capture or export service is required.
- Fixed perspective camera presets are front (0,0,8), side (8,0,0), above (0,8,0 with Z-up), and oblique (6,5,7), in authored viewpoint order; additional viewpoints repeat these deliberate orientations. Camera field of view is 45 degrees, clipping 0.1–100, and device pixel ratio capped at 2. Comparison uses two offset blocks; layers use bounded, separated slabs spanning four world units. All geometry is illustrative, not a measurement inferred from prose.
- Native viewpoint buttons and layer emphasis buttons use existing scene-action tokens. Enter/Space activates; selection is immediate, including reduced motion. There is no autoplay, orbit inertia or camera tween. Numbered projected markers tie geometry to persistent bilingual labels; selected labels are announced by a status region. Full authored explanations remain below.
- Three.js is bundled locally only into documents containing supported 3D scenes; no remote assets, shader/code fields or runtime model loading. More than 12 layers or viewpoints stays static-only. Rendering is demand-driven and suspended off-screen, when hidden, and in print. Removal/pagehide/context loss releases GPU geometry, materials, renderer, context, observers and handlers. BFCache return remounts from the static baseline.
- Personas: keyboard-only, motion-sensitive, bilingual, WebGL-disabled and script-disabled readers. Capture both scene kinds at 375/768/1280, every canonical viewpoint and layer, plus print/fallback. Static alternatives and teaching labels are mandatory, not accepted debt.

### Explanatory SVG scenes (Task22)

- Reuse reader paper, green, ink, line, body type, spacing and focus tokens. Numbered SVG marks refer to wrapping bilingual captions, never shrink long Japanese labels into an image. Layers overlap, comparisons sit side by side, timelines connect ordered milestones, and processes use directional arrows with an explicit return arrow for loops. Geometry uses a 320-unit-wide drawing grid: at least 32-unit horizontal gutters, 64-unit layer/timeline pitch, 24-unit circular nodes, and 64-unit-high comparison/process boxes on a 96-unit pitch. Layer rectangles are 88 units high, yielding 24 units of overlap. These are diagram coordinates, not page spacing. `--scene-width: 20rem` caps responsive drawings. Only shapes dim; numbered text retains full contrast.
- Shared native controls: Play, Pause, Replay, a labelled millisecond seek range and numbered state buttons. Buttons wrap, use body type and space-2/space-3 padding, and mark selection with green-soft plus an explicit current-state indicator. Controls are hidden until enhanced; explanations and the full trusted print-state inventory are always present.
- Novel teaching mechanism (not a decorative animation): a single finite shared scene clock, 1200ms per conceptual state, drives all SVG emphasis tracks through WAAPI opacity from 0.35 to 1. The beui range-slider reference informed direct, interruptible seeking and the immediate reduced-motion path; no spring or dependency is needed for a teaching clock. No autoplay, no infinite loop; loop arrows explain recurrence without forcing it on the reader.
- Play is opt-in; seek and state selection pause. Leaving the viewport, hiding the document, printing, or enabling reduced motion pauses and never silently restarts. Reduced motion and missing WAAPI retain immediate keyboard state selection, captions and complete static diagrams, with playback disabled. Print hides controls and restores full-opacity marks and both languages.
- Personas: bilingual learner comparing stages, keyboard-only reader, motion-sensitive reader, script-disabled reader. Verify every SVG kind, a non-loop process, initial/mid/final states, replay, visibility pause and reduced-motion changes at 375/768/1280px. No 3D renderer, export pipeline or Task23 work.

### Editorial lesson reader (Task21)

- **Primitives**: paired text, paired heading, native language radio group, numbered section, teaching-state list, practice explanation and source note. English and Japanese are adjacent within each semantic unit, not separate whole-document translations.
- **Layout**: open paper title and contents rail; raised-paper reading sections with green rules. Reuse source-reader widths, headings and focus tokens. At 390px use 20px gutters (`--space-5`); at 768px use 32px gutters and one reading column; at 1280px use a 14rem contents rail and paired text columns. Display titles use the existing display scale; section titles use the source-reader title scale. Reading text preserves authored line breaks without guessing translation alignment.
- **States**: paired by default; English-focus and Japanese-focus use native radios and CSS, with visible selected/focus states. The other language remains in the document and can be restored without script. Print always restores both. No animation, persistence claim or generated controls.
- **Static content**: every registry-derived teaching state, scene caption, scene/section practice prompt and option feedback is expanded in native sections. No scene animation, SVG renderer or WebGL is included. Sources are local in-document notes; arbitrary locator strings never become executable links.
- **Accessibility**: explicit language spans, one h1, sequential heading levels, focusable anchor destinations, wrapping navigation, normal Japanese line breaking and keyboard-operable radio arrows. Source, teaching and practice text never depends on hover, selection or script.
- **Persona/stress harness**: a bilingual reader comparing meanings, a keyboard-only reader, and a script-disabled reader. Showcase paired headings/text, long Japanese labels, hostile literal text, source notes, practice and focused modes at 390/768/1280px before composing lesson layouts. Accepted debt: none within Task21; animation and export are out of scope.

### Studio shell

- **Ownership**: React/Vite renders the open library authoring routes; Hono serves the built app and anonymous JSON APIs scoped to the persisted library namespace. Downloaded lesson HTML/PDF remains a separate, server-rendered safe projection that works offline without React or library APIs.
- **Structure**: skip link, semantic header, `main`, introductory section, paired language copy, static editorial mark, and concise footer note.
- **States**: the initial editorial shell is available at first paint; authoring routes have actual loading, empty and error states.
- **Accessibility**: one descriptive `h1`, landmarks, `lang` on Japanese text, selectable text, and logical source order.
- **Motion**: none at bootstrap.
- **Layout**: document scroll owns the page; the shell changes from one column at 390px to an asymmetric two-column grid by 768px.
- In the illustrated library, opening a desk compacts the desktop route rail to 60px (72px including its left gutter), matching the camera's visible-hall allowance. Scoped desk-state rules target the library scope root explicitly. The zoomed decorative world may extend beyond the viewport but is clipped/inert while the untransformed usable desk, scroll pane and controls remain bounded. Narrow screens retain the horizontal route rail.

### Owner job ledger

- **Structure**: source-reader shell, study-group headings, stacked raised-paper ledger entries with metadata, native action forms and paired EN/JA labels. Document scroll owns long lists; action rows wrap without horizontal scrolling.
- **States**: queued, running, paused, completed, failed and cancelled are named in text; accepted unknown outcomes have separate stop/retry decision forms. An unknown token receipt is not zero. Disabled action text explains current setup and budget prerequisites.
- **Interaction**: native buttons, labelled reason input, confirmation checkbox and visible inline status/alert. No automatic polling, provider switch, dialog or animation; refresh is a native action. The active job's state remains legible to keyboard and reduced-motion users.
- **Tokens**: source reader width (`--reader-width`), reading measure (`--reading-width`), paper/raised paper, ink/green/green-soft/line/muted/focus, and the existing spacing/type scale. No new token is required.

### Text link

- **Structure**: native anchor with a descriptive bilingual label.
- **States**: green underline at rest, ink on hover, slight opacity on active, and a 3px deep-coral focus ring with 4px offset.
- **Accessibility**: visible text names the destination; keyboard focus is never removed.
- **Motion**: color and opacity only, 120ms maximum; no movement.

### Paired language block

- **Structure**: adjacent English and Japanese paragraphs with explicit `lang` values.
- **States**: static in all conditions.
- **Accessibility**: both languages are available in the DOM at once and retain a clear reading order.
- **Motion**: none.

## 6. Motion & Interaction

### Summary downloads (TEN-9)

- Map the existing publication controls to the mockup's Display case: a green-soft last-stop note, raised-paper version cases, and distinct HTML/PDF volumes. Reuse the workspace paper, green, coral, ink, line, body type, spacing, links and focus treatment; add no tokens or motion.
- Only released outputs receive native download links. Queued, running and failed outputs remain explicit text states; failure must never look complete. Current and stale historical versions remain visibly distinct, and successful historical downloads remain available.
- Keep the existing artifact endpoints, formats, generation controls, approvals and offline behavior unchanged. Do not rewrite, replace, delete or restyle generated HTML/PDF, and do not add reader controls.
- At narrow widths, volumes stack in source order without horizontal overflow. Bilingual labels, native links and buttons, keyboard focus, and document scrolling remain intact.

### Publication approval and versioned files (Task28)

- Reuse the source-reader shell, React controls with native semantics, paired text, details, metadata and wrapping action rows. No new visual tokens or motion.
- Present only the cleaned projection before explicit Publish / Revise / Keep private choices. Keep evidence and privacy identities visible; put the complete projected-value inventory in native details.
- Publication means versioned downloadable files, available to anyone reaching this server. Show queued/running, current, old-version/stale and error states as text. Never replace a failed output with an older file labelled current. Preserve successful historical downloads.
- Every edit invalidates approval, including review decisions and the same lesson's captions, feedback, source notes and asset inventory. Revise clears approval eligibility and returns to review. A failed job requires Revise and fresh approval before another attempt.
- Personas: bilingual private reader, keyboard-only reader and script-disabled reader. Verify Publish, both downloads, Revise, stale tabs, Keep private, error and old versions at 375/768/1280px; metadata and labels must wrap. No additional styling debt is accepted.

### Evidence and privacy review

- Reuse the source-reader shell, React controls with native semantics, paired-language blocks, details and wrapping actions; no new colors or motion.
- Separate non-waivable locator/quotation failures from four human review categories: support, qualifications, translation and visual assumptions. Reviewed and acknowledged uncertainty remain distinct text states, never claims of machine-verified truth.
- Scan the exact allowlisted projection, including source-note prose, scene labels/captions, alt text, practice feedback and serialized strings. Present privacy paths, correction/removal controls and Keep private; never offer a privacy acknowledgement override. State that screening cannot guarantee anonymization.
- Every change resets review eligibility. The cleaned owner preview contains only projected content and its status, not private context, canaries or review forms. It does not publish or implement scene editing. A later approved download uses the separate standalone HTML/PDF renderer, not the React preview.
- Persona: bilingual private reader using keyboard or 375/768/1280px screens. Native details keep the full path inventory inspectable without overwhelming the initial reading view; correction forms have path-specific labels. Stale submissions receive a focused alert.

### Themed outline review

- Reuse the source-reader shell, paired-language paragraphs, ordered lists, React controls with native semantics and wrapping actions. No new tokens or animation.
- Show title/theme, numbered sections with learning goals, approved-question links, evidence, explicitly illustrative or source-grounded visual intentions, retained qualifications and excluded topics/sources before approval.
- Follow-up revision requests provide concrete choices and a separate custom-text form. Saving a revision never approves it. Pending, approved, deferred, revision-requested, flagged and outdated states use text.
- Approval is a separate revision-bound submission and the prerequisite for the normal worker's persisted lesson-section jobs. The Task18 fixture adapter remains a test utility, not a production blocker. Loopback wire JSON verifies plumbing, not live-model factual or translation quality; live credentials and real-book studies remain absent.
- Persona: private bilingual reader reviewing deliberately at 375/768/1280px, including keyboard-only use. Stale submissions receive a focused alert; source and custom text remain escaped.

### Reading brief approval

- Reuse the source-reader shell, native labelled controls, paired-language paragraphs and wrapping action row. No new colors, type scales or motion.
- Present scope/excluded sources, guiding/supporting questions, purpose, personal context, depth, languages and spoilers before the approval row. Original and refined questions remain separately labelled, with changed/unchanged indicators and an explicit selected version.
- Approve, Revise and Defer are separate native submissions. Save leads to review, never approval or generation. Original question text is retained; revisions can change the alternative and explicitly select it.
- Pending, approved, deferred, revision-requested and outdated states are text, never color alone. Stale or invalid submissions receive a focused alert. Descendants retain their history and display current/outdated status.
- Persona: the private bilingual reader deciding deliberately, including keyboard-only and narrow-screen use. Check 375/768/1280px, refresh, two stale tabs, editing after approval and literal hostile input. Outline generation is a separate downstream action.

### Saved interview

- TEN-23 keeps the interview route responsible for truthful readiness, even without a saved question bank. Reuse setup paper, native links, text status/alert, the library scroll owner and existing focus treatment. Name setup/review requirements or the affected analysis/questions stage; distinguish missing study from failed status retrieval. Progress links never send, retry or resolve an unknown outcome. Explicit Send refusals retain a connection/new-review action. Saved questions and answers take precedence over newer setup status. EN/JA labels wrap naturally at 375/768/1280px; no new tokens, motion or regeneration controls.
- Readiness reasons pair safe diagnostic codes with EN/JA explanations. Unknown outcomes require an explicit permitted stop/retry decision; exhausted budgets name the existing cancel path without promising retry or increased limits. A successful saved analysis advances the explanation to questions; unresolved sibling analysis windows still take precedence, with stable identity ordering rather than inferred job recency.
- Reuse the source-reader shell and all its tokens. Native radio/checkbox labels form raised-paper choice cards with line borders, green-soft selected fill and deep-coral keyboard focus. No animation or new visual tokens.
- The current question and its native controls sit on a raised-paper sheet with a green top rule. Existing save-before-navigation guidance sits beside it as a green-soft margin note on wide screens and follows it in reading order on narrow screens. This maps the approved `docs/mockups/library/index.html` reference-desk treatment without importing the mockup's sample content, shrine palette, depth or motion.
- Saved review entries use raised-paper index cards with a coral top rule. Their actual question, saved answer and Edit link remain selectable text; unanswered review entries retain the question-paper treatment rather than implying that an answer was saved.
- One question at a time, an explicit selection range, saved-count progress, Back/Next links and grouped native details for browsing beyond the shortlist. A saved-answer review provides Edit links. Optional bank questions never force an exhaustive questionnaire.
- Choice, custom text and unsure/skip use separate forms: each save replaces the current answer, never combines answer kinds. Required approval decisions have no custom, unsure or skip action; these decisions do not create downstream approvals.
- EN/JA navigation keeps the same question and saved answer. Save before changing pages; unsaved inputs are not claimed as saved. Errors receive focus, and every save returns an explicit saved status. Question and answer text remain escaped and selectable.
- Persona: a private bilingual reader using keyboard navigation or a narrow screen. Verify 375/768/1280px, radio arrows, checkbox Space, grouped browsing, reload and editing. No scoring; provider-backed question generation and brief approval are separate stages.

### Study setup

- TEN-25 keeps the existing paper/actions and adds no visual tokens or motion. Send has an immediate text status, a busy region and disabled decision controls while saving; it never implies transmission or a bank already exists. Granted review reloads show persisted consent and scheduling separately. Incomplete/blocked/uncertain outcomes have a consent-saved heading, not an approved-transmission heading. Repeated Send only reads the accepted status; the separate Resume action rechecks preparation, current local connection/model/destination and availability. Safe refusal codes persist and hide Resume; questions uncertainty directs explicit resolution to the existing jobs surface. Compatible saved questions link to the Reference desk; incompatible banks remain preserved and explicitly blocked. Keyboard/reload/lost-response states are required synthetic QA cases.

- TEN-21 subscription connections reuse the connection slip, ruled tickets, text stamps, native details and wrapping actions. Keep managed ChatGPT/Grok sign-in separate from source consent and existing explicit API/Codex choices. Pending login exposes only an official sign-in link; connected state updates selectable tool-reported models. Review and job results both show the reusable tool-managed notice: app-issued request counts, provider-managed credits/auto-reload, no hard cost/generation or full-isolation guarantee, and local-generation plus observed-account identity. Error, expired and local-only states stay textual. Claude eligibility remains pending. Show installation-wide/no-auth and hosted OpenRouter guidance. No new visual tokens, motion or credential-input fields.
- Lending-desk provider presentation: the existing native combined selector sits in a named raised-paper region. The ruled connection slip separates server-owned key guidance from an official Codex borrowing ticket. That ticket names the private Reading Studio workspace, presents the backend-derived Codex state as a bordered text stamp, and keeps the existing connect, refresh and disconnect lifecycle together. Labels, choices, controls, honest states and submission behavior remain unchanged; the connection never implies that it changes an API key. All papers wrap within the reading measure without motion.
- Reuse the source-reader paper, ink, typography, focus and spacing tokens in the React setup route; one reading-width column, no animation.
- Native labelled select, radio fieldset and chapter checkboxes lead to a separate transmission review. Controls use body text, 16px padding and a line-color border; actions wrap at narrow widths.
- Review lists selected and excluded resources, exact provider/model, book-text category, API credential availability and fixed call/source/output limits. Send, Revise and Cancel are separate native buttons; approval and cancellation have distinct headings.
- No credentials enter HTML. Missing credentials and stale drafts are recoverable states. Keyboard and 375/768/1280px checks cover choice, review and cancellation.

### Source reader

- React source-reader routes share the library origin and fetch Hono JSON data without authentication; no EPUB markup, styles, scripts, fonts or images are embedded. This library UI is not the standalone exported lesson HTML.
- Reading shell: paper canvas, raised-paper passage, green chapter links, green-soft citation highlight and coral keyboard focus. Reuse existing color and spacing tokens.
- Reader tokens: `--reader-width: 75rem`, `--reading-width: 46rem`, `--chapter-width: 14rem`, `--title-size: clamp(2rem, 5vw, 3rem)`, `--heading-size: 1.5rem`, `--body-size: 1rem`, `--label-size: .75rem`, `--line-height: 1.8`, `--rule: 1px`, `--focus-width: 3px`.
- Chapter navigation is an ordered list beside the passage above 768px and before it below that width. Document scroll owns the viewport. Text and provenance wrap, including long source locators.
- Native links retain keyboard behavior. Citation targets are focusable paragraphs, with exact quoted offsets highlighted; chapter headings receive focus on chapter navigation. No animation.
- Coverage summary always names complete/partial normalization, counts included resources and lists exclusions. Publisher page labels are edition-specific; absent labels are explicitly unavailable. Missing references return a visible recoverable error, not a blank reader.
- Persona: private reader checking a quotation, including keyboard-only and narrow-screen use. No layout fidelity to original EPUB pagination is claimed.

Bootstrap is static-first: no entrance, ambient, hover-transform, or auto-playing motion. Meaning never depends on animation. If later tasks add motion, only `transform`, `opacity`, or `filter` may animate; interaction feedback stays under 150ms, and `prefers-reduced-motion: reduce` must remove non-essential motion without hiding content.

Every interactive element uses native semantics and visible `:focus-visible`. No emoji may be used as an icon, label, decoration, alt text, or status signal.

## 7. Depth & Surface

The strategy is borders plus tonal shifts. Paper and raised paper distinguish layers; 1px line-color rules create structure. There are no generic cards, glass effects, gradients, or heavy shadows. The overlapping green/coral editorial mark is inline SVG or CSS geometry, never a raster screenshot.

## 8. Accessibility Constraints & Accepted Debt

- Target WCAG 2.2 AA: 4.5:1 body contrast, 3:1 large text and focus indicators.
- All controls and links are keyboard reachable with a visible coral focus ring.
- The shell is usable at 390px, 768px, and 1280px and at 200% zoom without primary-content clipping.
- Japanese glyphs must not clip vertically or break into isolated punctuation.
- Static content is the canonical initial state; reduced motion does not remove information.
- Accepted debt: none for the bootstrap shell.
