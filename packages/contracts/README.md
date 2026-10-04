# Shared Contracts

Import named schemas and inferred readonly types from `@reading-studio/contracts`.
Parse external data once with the appropriate schema. Records reject unknown keys;
nested records and collections are frozen after parsing. IDs are validated opaque
strings with distinct TypeScript brands. Schemas do not allocate IDs or write data.

Use joined boundaries when accepting related records: `AnswerSubmission`,
`NormalizedStudySetup`, `StudyAnalysis`, `AnalysisQuestionSet`, `WorkflowLineage`,
`TransmissionAuthorization`, `JobAuthorization`, `RunAttempts`, `PublicationRevision`
and `ApprovedArtifact`. Parsing an individual record cannot prove a foreign record
exists or that a caller is the current owner. Storage/authentication must establish
those facts and supply authoritative records, never caller-authored grants.

Analysis identity includes ordered source selection/exclusions, edition digest,
normalization revision, provider/model, analysis versions and all supported model
settings. Generation settings are deliberately outside that key. Extend and version
the settings contract before supporting another output-affecting provider parameter.
Source offsets use normalized JavaScript UTF-16 indices. Stable block identifiers
hash edition/normalizer/resource/block identity; they never depend on a viewport.

Scene content, labels and feedback are plain text, never markup. Trusted renderers
must escape them. `requiredTeachingStates` enumerates closed-variant content and
practice feedback, independent of supplied state lists. Captions may be omitted;
when supplied they must cover exactly all derived states. Labels/explanations supply
the non-GPU content; implementing its rendering is outside this package.

Publication schemas allowlist fields, not the semantic meaning of arbitrary text.
`projectedStrings` enumerates every string, including asset metadata, captions and
feedback. `PrivacyScreenedProjection` rejects known private details after Unicode,
case and whitespace normalization. This is not anonymization: a trusted semantic
review is still required. A passed review cannot retain findings. Every publication
approval is bound to a deterministic projection hash, complete reviewed paths and
derived state/asset manifests. Changed content needs a new review and approval.

No provider clients, automatic retries, dispatch, storage or rendering are included.
Attempt reservations and unknown usage are explicit data, not inferred zeroes.

```sh
bun run --cwd packages/contracts test
bun run --cwd packages/contracts manual:qa
```
