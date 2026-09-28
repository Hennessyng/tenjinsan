# Reading brief approval (Task17)

The authenticated owner reaches `/briefs/:study` from the saved interview. A current
setup and interview are required. The React editor reads and writes the owner-scoped
Hono JSON API. It records an original
question, optional refined alternative, up to three supporting question pairs,
purpose, private context, topic exclusions, depth, languages and spoiler policy.
Source scope and excluded source blocks come from the saved setup, not browser input.

Saving produces a review, never approval. The original question remains intact across
revisions; selecting an alternative is explicit. Both languages of a supplied question
must be nonempty. The review displays original/refined texts, changed/unchanged labels
and the selected question before separate Approve, Revise and Defer actions.

```text
saved interview + setup -> draft revision -> review -> approve
                                 ^             |         |
                                 +-- revise ---+         +-> eligible, no job enqueued
                                               +-> defer

edit brief / answers / setup -> old approval and descendants outdated
```

`storage.briefs` owns append-only drafts and decisions. Transactions bind decisions to
the current revision, exact setup, interview definition and answer sequence. A stale
decision returns HTTP 409. Changed content needs a new revision and approval; choosing
Revise immediately removes eligibility while retaining immutable history.

The existing approved `ReadingBrief` record is materialized only by explicit approval.
Outline enqueue requires the current approved brief as its input revision and the same
setup. Worker claim, completion, provider reservation and dispatch check current brief
eligibility. In-flight receipts remain recordable for accurate usage history.
Database triggers also fence stale outline, lesson, evidence, publication and artifact
writes. The brief screen reports those stored descendants as current or outdated.

Approval itself does not enqueue an outline or grant cloud-transmission consent;
the normal worker can generate an outline after the approved brief is submitted
to the generation flow. Refinement text is entered explicitly, not AI-rewritten.
Normal question discovery uses a consent-bound provider stage; these brief browser
tests seed a synthetic historical outline solely to check descendant invalidation.

Run `bun run test:integration -- approvals` and `bun run test:e2e -- brief`.
Evidence and the completion claim are in `.omo/evidence/reading-studio/task-17/`.
