# Workspace Accessibility Assessment

## Release And Conclusion

Assessed interaction release: `533228939dee6f39479cd114e30b91c6692a0fa5`,
2026-10-04, TEN-13 run-driver, Chromium `153.0.8010.12`, Playwright `1.63.0`,
Node `24.19.0`. The formatter-only commit preserves T1/T2 assertions.
**WCAG 2.2 AA is not established. AC3 is incomplete, not a conformance pass.**
Safari is **not-run by owner**, never a pass. Installed VoiceOver reports version
`10`; no actual reading or announcement results were obtained. The exact attempt
and `System Events ... Can't get process "VoiceOver". (-1728)` are recorded below.
An accessibility-tree snapshot is not a screen-reader observation.

## Reproducible Evidence

Run evidence root:
`.sisyphus/runs/ten-13-keep-workspace-interaction-accessible/evidence/`.

- `T3-current-driver-profile.json`: one pre-proof Jev decision, configured driver.
- `current-proof.ts`, `current-proof.json`: real authenticated synthetic fixture,
  public UI observations, build hashes, publication approval/generation/downloads
  and same-data rollback results. No paid provider calls or private books.
- `current-route-observations.json`: 22 route/state rows at 1280 and 320 CSS pixels,
  rendered control inventory, focus traces, language and opaque color samples.
- `current-{width}-{index}.png` and `.yml`: screenshots and browser semantics;
  indices map to the `paths` array, not a historical route list.
- `current-contrast.json`: 1566 sampled opaque text/background pairs, zero failing
  sample ratios, two unmeasured samples. This is not a whole-page scanner or a
  proof of every non-text control, gradient, image or composited background.
- `current-summary.json` and `current-manifest.json`: concise assessed-release
  receipt and SHA256 hashes of current evidence artifacts.
- `current-screen-reader.json`: exact failed command, installed version and no
  fabricated observations. No host permissions were changed.
- `current-error-focus.png`, `text-spacing-review.png`,
  `manual-css-zoom-review.png`, `current-released-files.png`,
  `reverted-source.png`, `current-fallback.png`, `current-preview.png`,
  `current-read.png`: supplementary visual evidence.
- `current-ac12.log`, `current-lint.log`, `current-typecheck.log`: current checks.

The reviewed desktop setup/error screenshots show the error destination visibly
outlined and inside the page. The 320px review, brief, outline, evidence,
publication and revision screenshots show wrapping without page-width overflow.
The review screenshot with increased spacing shows readable, separated content.
CSS zoom `2` on the review page remained bounded at a 1512px viewport. That is
a CSS magnification stress check, **not native browser zoom**. A native zoom
shortcut attempt supplied no verified zoom result. Actual 200%/400% browser zoom
is not-run. Reflow observations use an actual 320 CSS pixel viewport.

## Route And Action Coverage

The route matrix includes home, imports, source library, source chapter and
citation targets, setup choices/review, interview list/detail/English/Japanese,
interview review in both languages using **`step=~review`**, brief, outline,
jobs, evidence list/detail, publication, revisions, missing source/interview.
The asset-free owner fallback and existing preview/read endpoints were also
captured. Native login was performed with Tab, typing and Enter. The manual
browser pass observed skip activation moving focus to `#studio`.

Keyboard actions observed: skip activation; native radio ArrowDown selection;
setup submission with no selected chapters focusing its visible error; job
refresh retaining focus; explicit Publish; Generate approved files; HTML and
PDF download by Enter. The native file chooser was keyboard-reachable and
emitted a chooser event in the manual browser; file selection/import completion
was not assessed in this pass. T1/T2 acceptance tests passed all four existing
keyboard/focus cases, including cancellation result focus.

The full per-route **available** control matrix is in `rows[].controls`.
Availability or an accessible-tree entry is not execution proof. Not-run actions
include live provider connection/sign-in, every interview answer alternative,
all brief/outline/revision decisions, import refusal/recovery, every job
cancel/retry/resolve state, and all evidence edits/approval-invalidating choices.
Normal, missing-resource, empty jobs, validation error, queued generation and
released outputs were observed. Every loading/busy/stale/error combination was
not staged. This is a broad route assessment, not complete-process conformance.

Historical S12 `normal-chromium/receipt.json` belongs to TEN-12 and uses
`view=review`, which does not establish the current interview review screen.
Current index 11/12 screenshots replace that gap with the real review query;
the historical S12 Safari waiver remains **not-run**, not inherited proof.

## Same-Data Interaction Rollback

The prior studio build at `f6dbb873385aaae09a6e02d669b7fbb1f99dee25` was
served against the same retained synthetic API process, SQLite and private
blobs, then the current build was restored. T1/T2 changed no server code.
The proof records both aggregate studio-build hashes, unchanged public source,
interview-answer, brief and outline response hashes, identical publication
approval/output response bytes, and identical released HTML/PDF download hashes.
No database restoration/migration or export regeneration occurred during the
switch. Prior/current source screenshots were captured. This is a disposable
same-data release simulation, not a production deployment or Safari rollback.
The working branch's T1/T2 commits were never reverted.

## WCAG 2.2 A/AA Evidence Register

`Partial` means observed checks support part of the criterion, not a criterion
pass over the whole workspace. `Not-run` is explicitly unassessed. `N/A sample`
applies only to the inspected fixture screens, not an unassessed product state.
No row below grants a whole-workspace conformance result.

| Criterion | Observed Result | Evidence Or Remaining Check |
| --- | --- | --- |
| 1.1.1 Non-text Content | Partial | Native controls/brand semantics captured; all graphical alternatives not reviewed. |
| 1.2.1 Audio-only and Video-only | N/A sample | No recorded audio/video on inspected workspace screens. |
| 1.2.2 Captions | N/A sample | No prerecorded video in inspected sample. |
| 1.2.3 Audio Description or Media Alternative | N/A sample | No prerecorded video in inspected sample. |
| 1.2.4 Captions Live | N/A sample | No live audiovisual content in inspected sample. |
| 1.2.5 Audio Description | N/A sample | No prerecorded video in inspected sample. |
| 1.3.1 Info and Relationships | Partial | Browser semantics recorded; screen-reader/table/form associations incomplete. |
| 1.3.2 Meaningful Sequence | Partial | Review visual order inspected; screen-reader reading order not-run. |
| 1.3.3 Sensory Characteristics | Partial | Visible instructions inspected; exhaustive instruction audit not-run. |
| 1.3.4 Orientation | Not-run | Device orientation assessment not performed. |
| 1.3.5 Identify Input Purpose | Partial | Native email/password login used; purpose-token inventory incomplete. |
| 1.4.1 Use of Color | Partial | Publication/error text labels visible; exhaustive non-color cues not-run. |
| 1.4.2 Audio Control | N/A sample | No automatic audio observed on inspected screens. |
| 1.4.3 Contrast Minimum | Partial | Sampled ratios meet thresholds; two unmeasured/composited cases remain. |
| 1.4.4 Resize Text | Partial | CSS 2x review stress check; native browser zoom not-run. |
| 1.4.5 Images of Text | Partial | Text content rendered as text; full image inventory not-run. |
| 1.4.10 Reflow | Partial | All 44 route/width rows bounded, including 320px; native zoom/process states remain. |
| 1.4.11 Non-text Contrast | Not-run | Complete control/state/focus-adjacent color measurement missing. |
| 1.4.12 Text Spacing | Partial | Review spacing screenshot inspected; every screen/control not assessed. |
| 1.4.13 Content on Hover or Focus | Not-run | Exhaustive additional-content dismissal/hover/persistence checks missing. |
| 2.1.1 Keyboard | Partial | Listed real keyboard actions work; available-control inventory is not all-action proof. |
| 2.1.2 No Keyboard Trap | Partial | Traversed routes and downloads; all widgets/processes not assessed. |
| 2.1.4 Character Key Shortcuts | Not-run | Exhaustive character-shortcut assessment missing. |
| 2.2.1 Timing Adjustable | Not-run | Session expiration/timed-state assessment missing. |
| 2.2.2 Pause Stop Hide | Partial | No moving content observed in route captures; timed updates not fully assessed. |
| 2.3.1 Three Flashes or Below Threshold | Partial | No flashing observed; not a temporal flash analysis. |
| 2.4.1 Bypass Blocks | Partial | Skip links activate real main targets; full process matrix remains. |
| 2.4.2 Page Titled | Partial | Browser page title observed; route-specific descriptive title audit incomplete. |
| 2.4.3 Focus Order | Partial | Setup error/cancel and job refresh tests; remaining transitions not-run. |
| 2.4.4 Link Purpose in Context | Partial | Named links recorded; exhaustive purpose review not-run. |
| 2.4.5 Multiple Ways | Partial | Rooms/source/interview links captured; full navigation audit not-run. |
| 2.4.6 Headings and Labels | Partial | Review and form headings visible; exhaustive semantics review missing. |
| 2.4.7 Focus Visible | Partial | Main/error outlines inspected; every control/background not assessed. |
| 2.4.11 Focus Not Obscured Minimum | Partial | Error/main destinations visible; all narrow/state controls not assessed. |
| 2.5.1 Pointer Gestures | Not-run | Complete pointer gesture audit missing. |
| 2.5.2 Pointer Cancellation | Not-run | Pointer-down/up cancellation assessment missing. |
| 2.5.3 Label in Name | Partial | Named controls captured; exhaustive visible-label comparison missing. |
| 2.5.4 Motion Actuation | Not-run | Device motion behavior not assessed. |
| 2.5.7 Dragging Movements | Not-run | Complete drag-alternative audit missing. |
| 2.5.8 Target Size Minimum | Partial | Control rectangles recorded; exception/spacing assessment missing. |
| 3.1.1 Language of Page | Partial | English/Japanese document language recorded for route rows. |
| 3.1.2 Language of Parts | Partial | Mixed-language browser semantics recorded; actual AT switching not-run. |
| 3.2.1 On Focus | Partial | Tab traversals observed; every control not assessed. |
| 3.2.2 On Input | Partial | Native radio selection observed; all selection changes not assessed. |
| 3.2.3 Consistent Navigation | Partial | Repeated room navigation captured; complete flow review missing. |
| 3.2.4 Consistent Identification | Partial | Repeated links/buttons captured; full consistency audit missing. |
| 3.2.6 Consistent Help | Not-run | Help mechanism audit missing. |
| 3.3.1 Error Identification | Partial | Explicit chapter-selection alert visible and focused. |
| 3.3.2 Labels or Instructions | Partial | Setup/login instructions captured; all forms not assessed. |
| 3.3.3 Error Suggestion | Partial | Missing chapter alert suggests explicit selection; other errors not assessed. |
| 3.3.4 Error Prevention Legal Financial Data | Partial | Explicit publication decision observed; every consequential choice not assessed. |
| 3.3.7 Redundant Entry | Not-run | Complete multi-step redundant-entry audit missing. |
| 3.3.8 Accessible Authentication Minimum | Partial | Native credential entry works; password-manager/paste/cognitive audit incomplete. |
| 4.1.2 Name Role Value | Partial | Browser semantics recorded; comprehensive AT/control audit missing. |
| 4.1.3 Status Messages | Not-run | Browser status nodes captured, but actual announcements not observed. |

## Release Gate

The unchanged pending AC3 test rejects missing actual screen-reader proof. It
must not be changed to turn this incomplete assessment into AA. Coverage records
AC1/AC2 passing and AC3 incomplete. The final ladder/smoke/behavior sequence
cannot be reported GREEN while that required task remains incomplete.
