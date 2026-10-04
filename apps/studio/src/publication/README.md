# Publication panel (Task28)

`/publications/:study` is an authenticated React owner panel backed by Hono JSON APIs.
It shows the cleaned projection, its complete value inventory, evidence/privacy
identities, explicit Publish / Revise / Keep private choices and version history.
It reuses the source-reader design system; only the exported offline HTML/PDF
are independent of React and owner APIs.

Publish freezes the current reviewed projection, content hash, evidence report,
privacy review, renderer version and derived teaching-state/asset manifests.
It creates two durable local output jobs. Generate approved files requests their
execution via the owner API; the normal worker renders queued HTML and PDF jobs.
These are local rendering jobs, not cloud-generation jobs; they do not require
or consume a provider transmission grant. The HTML is a self-contained,
server-rendered safe projection, not a client-side authoring app. Neither the
offline HTML nor PDF needs React or owner APIs after download. No public sharing
URL is created.

```
current reviewed content -> immutable approval -> HTML/PDF jobs
                                  |                   |
                                  +-- recheck --------+-> validated release
edited review/source/lesson ------+-> stale; old released bytes retained
```

SQLite immediate transactions gate approval, single-use claims and release.
Every new review revision invalidates the approval, even if the lesson ID or
projection hash is unchanged. Newer lessons and upstream setup/outline changes
also block work. The service recomputes current evidence before rendering and
again before release. Requests cannot supply projections, renderer versions or
approval manifests. Bump `PUBLICATION_RENDERER` when rendering/validation changes.

Snapshots and terminal jobs are immutable. Successful bytes, artifact metadata
and terminal status are committed together in SQLite. A claimed job expires
after 120 seconds; subsequent reads turn interrupted work into an explicit error,
never a successful file. A competing request cannot fail the winning renderer's
claim. Failures require Revise, renewed review and new approval rather than an
automatic retry. Queued jobs can be executed after a server restart.

`/publication-artifacts/:job` returns only released bytes after owner and integrity
checks, with attachment disposition, no-store, nosniff and sandbox headers.
The immutable ID and publication ID in the filename identify the version.
`X-Publication-State` distinguishes current from stale; an old successful file
remains downloadable by its owner after edits or Keep private. Previously
downloaded copies cannot be recalled.

This component's historical verification used synthetic local fixtures and real
SQLite, owner login, HTTP, HTML rendering and sandboxed Chromium PDF rendering.
Those fixture tests made no provider call or private-book semantic assessment;
normal local and Compose pipeline tests use synthetic loopback wire JSON to check
plumbing, not factual or translation quality. No paid live call is claimed.
Evidence and exact historical commands:
`.omo/evidence/reading-studio/task-28/DoneClaim.json`.
