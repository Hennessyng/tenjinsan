# Saved interview (Task16)

React owns `/interviews` and `/interviews/:study` on the authenticated origin;
Hono supplies the owner-scoped `/api/interviews` JSON reads and writes.
No question bank means an explicit empty state, not invented questions.

Trusted application code can pass Task15's `generateQuestions` result to
`interviewFromDiscovery({ id, bank })` from `@reading-studio/studio/interview`,
then call `storage.interviews.create(definition)`. The definition pins the study,
analysis, context, groups, shortlist and complete question snapshots. Registration
is not exposed to the browser. `generateQuestions(input, fixtureOutput)` is a
fixture utility for authored test outputs; the normal worker pipeline separately
dispatches consent-bound questions through the Vercel AI SDK. Brief approval is
a separate React route, not a side effect of registering an interview.

React controls send authenticated JSON actions saved to SQLite. Reload, language links,
back and edit read those saved answers. Unsaved fields are explicitly not saved;
the page asks the reader to save before navigating. Choice, custom, unsure and skip
are separate submissions and replace one another. Empty/over-limit/stale/mixed
submissions return focused errors. React renders text safely; its requests stay on
the authenticated origin, and it makes no provider request. Authentication,
ownership, origin and body limits
apply to every write.

The shortlist is only a starting point. Other lenses remain accessible by group.
Approval-purpose steps require explicit options and disallow custom/unsure/skip;
their recorded decisions never create transmission or publication approvals.
Preference responses have no correctness, score or practice feedback.

Definitions and answers are append-only. A newer definition for a study invalidates
old submissions without rewriting old answer snapshots. A changed definition must
use a new ID. Edits append an answer and display its newest revision.

Verification: `bun run test:unit -- answers`, `bun run test:integration -- interview`,
and `bun run test:e2e -- interview`. Evidence is under
`.omo/evidence/reading-studio/task-16/`.
