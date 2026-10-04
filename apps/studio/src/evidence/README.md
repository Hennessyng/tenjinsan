# Evidence and privacy gate (Task20)

`/evidence/:study` opens the latest generated lesson. Exact lesson URLs and the
separate `/preview` page require owner authentication and current outline/brief
lineage. The React review calls owner-authenticated Hono JSON APIs and reuses
the source-reader design system. It does not embed executable EPUB pages or
provide a scene editor; publication requires its own separate approval.

The review service constructs a strict allowlisted projection. Local source
locators and quotations are mechanically checked against the exact stored
normalization. Support, qualifications, translation and visual assumptions remain
separate **human** reviews. Each starts unresolved; reviewed judgments and
acknowledged uncertainty are distinct. Neither is machine-certified truth.
Readers can inspect original passages and correct or remove projected content.

Privacy screening walks every projected string, including identifiers, source
notes, scene labels/captions, practice feedback, asset descriptions and serialized
strings. Known private details/translated aliases, contact/secret patterns and
manual flags assist the reader. Add aliases explicitly: this is not a translation
model, a general named-entity detector or a guarantee of anonymization. Manual
privacy findings become persistent private canaries, so moving flagged text does
not clear it. No acknowledgement override exists for privacy.

Every correction appends an immutable SQLite review revision and clears semantic
and privacy review eligibility. The report is derived from exact lesson and
projection hashes, complete projected paths and saved review decisions. Stale
tabs reject. Keep private blocks readiness. The owner preview route renders only allowlisted
projection content plus review status; private details, original lesson objects,
reader context and internal review data never enter its body or embedded data.

Readiness permits a separate publication approval, not publication itself. New
reviews do not mint legacy publication approvals or export artifacts.

Verification: `bun run test:integration -- evidence` and
`bun run test:e2e -- evidence`. All fixtures are synthetic, use isolated temporary
SQLite databases, and make no provider calls.
