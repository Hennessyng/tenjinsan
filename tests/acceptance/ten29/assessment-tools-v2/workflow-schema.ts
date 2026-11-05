import { z } from "zod"
import { ConstructedLabel, ControlKind, TechnicalEvidence } from "./constructed-schema.ts"
import { RubricInput } from "./rubric-schema.ts"
export const Text = z.string().trim().min(1)
export const Digest = z.string().regex(/^[a-f0-9]{64}$/u)
export const DocumentCode = z.string().regex(/^D-[a-f0-9]{24}$/u)
export const CandidateCode = z.string().regex(/^C-[a-f0-9]{24}$/u)
export const Mode = z.enum(["HUMAN", "DUMMY_ONLY"])
export const Manifest = z
  .strictObject({
    version: z.literal("TEN29-human-packet-3"),
    mode: Mode,
    packetDigest: Digest,
    documents: z
      .array(
        z.strictObject({
          documentCode: DocumentCode,
          sourceDigest: Digest,
          family: Text,
          round: z.enum(["first", "second"]),
          constructedInapplicableKinds: z.array(ControlKind),
          candidates: z
            .array(
              z.strictObject({
                candidateCode: CandidateCode,
                contentDigest: Digest,
                languagesProvided: z
                  .array(z.enum(["en", "ja"]))
                  .min(1)
                  .max(2),
                formats: z.array(z.enum(["epub", "docx", "txt", "pdf"])).min(1),
                equivalenceDigest: Digest,
                constructed: ConstructedLabel,
                technical: TechnicalEvidence,
              }),
            )
            .min(1),
        }),
      )
      .min(1),
  })
  .superRefine((value, ctx) => {
    const documents = value.documents.map((row) => row.documentCode),
      codes = value.documents.flatMap((row) =>
        row.candidates.map((candidate) => candidate.candidateCode),
      )
    if (new Set(documents).size !== documents.length || new Set(codes).size !== codes.length)
      ctx.addIssue({ code: "custom", message: "Duplicate document/candidate" })
    for (const document of value.documents) {
      const kinds = document.candidates.flatMap((candidate) =>
        candidate.constructed.kind === null ? [] : [candidate.constructed.kind],
      )
      if (
        new Set(document.constructedInapplicableKinds).size !==
          document.constructedInapplicableKinds.length ||
        document.constructedInapplicableKinds.some((kind) => kinds.includes(kind)) ||
        ControlKind.options.some(
          (kind) => !kinds.includes(kind) && !document.constructedInapplicableKinds.includes(kind),
        ) ||
        document.candidates.some(
          (candidate) =>
            new Set(candidate.formats).size !== candidate.formats.length ||
            new Set(candidate.languagesProvided).size !== candidate.languagesProvided.length,
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Incomplete/duplicate constructed coverage or format metadata",
        })
    }
  })
export type Manifest = z.infer<typeof Manifest>
export const Enrollment = z.strictObject({
  mode: Mode,
  humanId: Text,
  packetDigest: Digest,
  approvalReference: Text,
  role: z.literal("independent-human"),
  noAuthorshipOverlap: z.literal(true),
  exposureDisclosure: Text,
  coordinatorId: Text,
})
export type Enrollment = z.infer<typeof Enrollment>
const ChapterAnswer = z.strictObject({
  partOrdinal: z.number().int().min(1).max(4),
  materialContribution: Text,
  question: Text,
  independentlyAuthoredAnswer: Text,
  originalGrounding: Text,
  uncertainties: Text,
})
export const SourceRecord = z
  .strictObject({
    kind: z.literal("source-only-record"),
    mode: Mode,
    packetDigest: Digest,
    documentCode: DocumentCode,
    humanId: Text,
    sourceDigest: Digest,
    exposureAndConflicts: Text,
    sourceOnlyOpenedAt: z.string().datetime(),
    chapters: z.array(ChapterAnswer).length(4),
    crossBookQuestionsAndAnswers: z
      .array(
        z.strictObject({
          question: Text,
          independentlyAuthoredAnswer: Text,
          originalGrounding: Text,
          partOrdinals: z.array(z.number().int().min(1).max(4)).min(2).max(4),
        }),
      )
      .min(1),
    humanAuthorshipAttestation: z.literal(true),
    lockedBeforeCandidatesAt: z.string().datetime(),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.chapters.map((row) => row.partOrdinal)).size !== 4 ||
      value.crossBookQuestionsAndAnswers.some(
        (row) => new Set(row.partOrdinals).size !== row.partOrdinals.length,
      ) ||
      Date.parse(value.lockedBeforeCandidatesAt) < Date.parse(value.sourceOnlyOpenedAt)
    )
      ctx.addIssue({ code: "custom", message: "Invalid chapter/question chronology" })
  })
export type SourceRecord = z.infer<typeof SourceRecord>
export const Assessment = z.strictObject({
  kind: z.literal("human-first-pass"),
  mode: Mode,
  packetDigest: Digest,
  documentCode: DocumentCode,
  candidateCode: CandidateCode,
  contentDigest: Digest,
  humanId: Text,
  sourceLockDigest: Digest,
  mechanicalProofDigest: Digest,
  rubric: RubricInput,
  humanAuthorshipAttestation: z.literal(true),
  completedAt: z.string().datetime(),
})
export type Assessment = z.infer<typeof Assessment>
export const Reference = z
  .strictObject({
    kind: z.literal("label-corroboration"),
    mode: Mode,
    packetDigest: Digest,
    candidateCode: CandidateCode,
    humanId: Text,
    firstPassDigest: Digest,
    constructedLabelDigest: Digest,
    disposition: z.enum(["agree", "dispute"]),
    label: z.enum(["faithful", "negative", "unresolved"]).nullable(),
    criticalNegative: z.boolean().nullable(),
    humanConfirmedKinds: z.array(Text),
    originalGroundedReason: Text,
    humanAuthorshipAttestation: z.literal(true),
    completedAt: z.string().datetime(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.disposition === "agree" &&
        (value.label !== null || value.criticalNegative !== null)) ||
      (value.disposition === "dispute" &&
        (value.label === null ||
          (value.label === "unresolved") !== (value.criticalNegative === null) ||
          (value.label === "faithful" && value.criticalNegative !== false)))
    )
      ctx.addIssue({ code: "custom", message: "Reference criticality unresolved/inconsistent" })
  })
export type Reference = z.infer<typeof Reference>
export const AdjudicatorEnrollment = z.strictObject({
  mode: Mode,
  packetDigest: Digest,
  humanId: Text,
  role: z.literal("independent-adjudicator"),
  approvalReference: Text,
  noAuthorshipOverlap: z.literal(true),
  didNotEvaluateFirstPass: z.literal(true),
  exposureDisclosure: Text,
})
export type AdjudicatorEnrollment = z.infer<typeof AdjudicatorEnrollment>
export const Adjudication = z.strictObject({
  kind: z.literal("human-adjudication"),
  mode: Mode,
  packetDigest: Digest,
  candidateCode: CandidateCode,
  humanId: Text,
  referenceDigest: Digest,
  label: z.enum(["faithful", "negative", "unresolved"]),
  criticalNegative: z.boolean().nullable(),
  humanConfirmedKinds: z.array(Text),
  retainedOriginalRecord: z.literal(true),
  originalGroundedReason: Text,
  completedAt: z.string().datetime(),
})
export type Adjudication = z.infer<typeof Adjudication>
export const Sealed = z.strictObject({ payload: z.string(), mac: Digest })
export type Sealed = z.infer<typeof Sealed>
