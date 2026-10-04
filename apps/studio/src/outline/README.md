# Themed study outlines (Task18)

```
current approved brief -> provider-backed proposal -> React review -> exact approval
                              ^                |
                              +-- choices/custom revision
editing outline/brief/setup/answers -> previous approval becomes ineligible
```

The authenticated React `/outlines/:study` route follows the approved brief via Hono JSON APIs. It displays
theme/title, learning goals, ordered sections, approved-question links, evidence,
visual intentions, retained qualifications and excluded topics/source areas. React
controls offer separate approval, defer and revision actions. Follow-up revision
requests provide reverse-order and simplify-visual choices plus a custom intention.

`storage.outlines` saves immutable SQLite drafts and decisions. The approved legacy
`StudyOutline` is materialized only on approval; the full title/theme, question links,
qualifications, exclusions and feedback remain bound to that ID in its immutable
draft. Stale decisions reject transactionally. Editing removes eligibility without
deleting history. Lesson enqueue, worker claim/dispatch/completion and lesson writes
reject obsolete outline approval. Approval itself never enqueues work.

The synthetic test server can still inject a fixture provider. The normal worker
uses the Vercel AI SDK behind explicit Send consent and backend-only credentials
for outline and bounded persisted lesson-section jobs, reassembled in order.
Fixture tests need no credentials and don't transmit private books. Ordinary
pipeline evidence uses synthetic loopback wire JSON, not a live model, paid
calls or proof of private-book teaching and translation quality. F4 remains `[~]`.

Evidence: `.omo/evidence/reading-studio/task-18/DoneClaim.json` and `rubric.md`.
Run `bun run test:integration -- outline` and `bun run test:e2e -- outline`.
