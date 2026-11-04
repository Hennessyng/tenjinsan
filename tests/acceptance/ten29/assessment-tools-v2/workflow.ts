import { z } from "zod"
import { digest, seal } from "./integrity.ts"
import { replayInto } from "./replay.ts"
import { ReviewLedger } from "./review-ledger.ts"
import { Assessment, Enrollment, Manifest, type Sealed, SourceRecord } from "./workflow-schema.ts"

const Tuning = z.strictObject({
  kind: z.literal("tuning-complete"),
  mode: z.enum(["HUMAN", "DUMMY_ONLY"]),
  packetDigest: z.string(),
  humanId: z.string(),
  noProtocolChange: z.literal(true),
  reason: z.string().trim().min(1),
  completedAt: z.string().datetime(),
})
export class HumanWorkflow {
  private readonly manifest: Manifest
  private readonly enrollment: Enrollment
  private readonly key: Buffer
  private readonly sources = new Map<string, SourceRecord>()
  private readonly assessments = new Map<string, Assessment>()
  private readonly review: ReviewLedger
  private readonly released = new Set<string>()
  private tuningAt: string | null = null
  private readonly journal: Sealed[] = []
  constructor(input: {
    readonly manifest: unknown
    readonly enrollment: unknown
    readonly key: Buffer
  }) {
    this.manifest = Manifest.parse(input.manifest)
    const { packetDigest, ...body } = this.manifest
    if (digest(body) !== packetDigest) throw new TypeError("Manifest digest mismatch")
    this.enrollment = Enrollment.parse(input.enrollment)
    this.review = new ReviewLedger({ manifest: this.manifest, enrollment: this.enrollment })
    if (
      this.enrollment.packetDigest !== this.manifest.packetDigest ||
      this.enrollment.mode !== this.manifest.mode ||
      this.enrollment.humanId === this.enrollment.coordinatorId ||
      input.key.length < 32
    )
      throw new TypeError("Unauthorized enrollment/packet")
    if (
      this.manifest.mode === "HUMAN" &&
      /dummy/iu.test(this.enrollment.humanId + this.enrollment.approvalReference)
    )
      throw new TypeError("Dummy authority cannot enroll a human packet")
    this.key = Buffer.from(input.key)
  }
  private actor(value: {
    readonly packetDigest: string
    readonly mode: string
    readonly humanId: string
  }) {
    if (
      value.packetDigest !== this.manifest.packetDigest ||
      value.mode !== this.enrollment.mode ||
      value.humanId !== this.enrollment.humanId
    )
      throw new TypeError("Wrong actor/packet/mode")
  }
  private record(kind: string, body: unknown) {
    const value = seal(
      {
        kind,
        previousDigest: digest(this.journal.at(-1) ?? null),
        packetDigest: this.manifest.packetDigest,
        humanId: this.enrollment.humanId,
        mode: this.enrollment.mode,
        body,
      },
      this.key,
    )
    this.journal.push(value)
    return value
  }
  lockSource(input: unknown) {
    const value = SourceRecord.parse(input)
    this.actor(value)
    const document = this.manifest.documents.find((row) => row.documentCode === value.documentCode)
    if (
      !document ||
      document.sourceDigest !== value.sourceDigest ||
      this.released.size ||
      this.sources.has(value.documentCode)
    )
      throw new TypeError("Wrong/duplicate/exposed source record")
    this.sources.set(value.documentCode, value)
    return this.record("source", value)
  }
  release(round: "first" | "second") {
    if (
      this.sources.size !== this.manifest.documents.length ||
      this.released.has(round) ||
      (round === "second" && this.tuningAt === null)
    )
      throw new TypeError("Source/question lock or tuning gate incomplete")
    const documents = this.manifest.documents.filter((row) => row.round === round)
    if (!documents.length) throw new TypeError("Unknown empty round")
    this.released.add(round)
    return this.record("release", { round })
  }
  submitAssessment(input: unknown) {
    const value = Assessment.parse(input)
    this.actor(value)
    const document = this.manifest.documents.find((row) => row.documentCode === value.documentCode),
      candidate = document?.candidates.find((row) => row.candidateCode === value.candidateCode),
      source = this.sources.get(value.documentCode)
    if (
      !document ||
      !candidate ||
      !source ||
      !this.released.has(document.round) ||
      this.assessments.has(value.candidateCode) ||
      candidate.contentDigest !== value.contentDigest ||
      digest(source) !== value.sourceLockDigest ||
      Date.parse(value.completedAt) < Date.parse(source.lockedBeforeCandidatesAt)
    )
      throw new TypeError("Wrong candidate/question lock/order or duplicate first pass")
    if (
      JSON.stringify([...candidate.languagesProvided].sort()) !==
      JSON.stringify([...value.rubric.languagesProvided].sort())
    )
      throw new TypeError("Wrong supplied languages")
    if (
      value.mechanicalProofDigest !== candidate.technical.evidenceDigest ||
      value.rubric.criticalFlags["incomplete-included-processing"] !==
        candidate.technical.incompleteIncludedProcessing ||
      value.rubric.criticalFlags["unauthorized-authority-change"] !==
        candidate.technical.unauthorizedAuthorityChange ||
      value.rubric.criticalFlags["missed-seeded-critical-negative"] !== "post-reference"
    )
      throw new TypeError("Read-only machine facts/derived marker differ from evidence")
    if (
      document.round === "second" &&
      Date.parse(value.completedAt) < Date.parse(this.tuningAt ?? "")
    )
      throw new TypeError("Held-out response precedes tuning lock")
    this.assessments.set(value.candidateCode, value)
    return this.record("assessment", value)
  }
  finishTuning(input: unknown) {
    const value = Tuning.parse(input)
    this.actor(value)
    const first = this.manifest.documents
      .filter((row) => row.round === "first")
      .flatMap((row) => row.candidates)
    if (
      !this.released.has("first") ||
      this.released.has("second") ||
      this.tuningAt !== null ||
      first.some((row) => !this.assessments.has(row.candidateCode))
    )
      throw new TypeError("Tuning decisions cannot precede complete first round")
    if (
      first.some(
        (row) =>
          Date.parse(this.assessments.get(row.candidateCode)?.completedAt ?? "") >
          Date.parse(value.completedAt),
      )
    )
      throw new TypeError("Tuning timestamp precedes first pass")
    this.tuningAt = value.completedAt
    return this.record("tuning", value)
  }
  submitReference(input: unknown) {
    return this.record("reference", this.review.submitReference(input, this.assessments))
  }
  unblind() {
    return this.record("unblind", this.review.unblind(this.assessments))
  }
  authorizeAdjudicator(input: unknown) {
    return this.record("adjudicator", this.review.authorize(input))
  }
  adjudicate(input: unknown) {
    return this.record("adjudication", this.review.adjudicate(input))
  }
  adjudicateCoverage(input: unknown) {
    return this.record("coverage-adjudication", this.review.adjudicateCoverage(input))
  }
  confirmCoverage(input: unknown) {
    return this.record("coverage", this.review.confirmCoverage(input))
  }
  snapshot() {
    return structuredClone({
      manifest: this.manifest,
      enrollment: this.enrollment,
      sources: [...this.sources.values()],
      assessments: [...this.assessments.values()],
      ...this.review.snapshot(),
      released: [...this.released],
      tuningComplete: this.tuningAt !== null,
      journal: this.journal,
    })
  }
  replay(input: unknown) {
    replayInto(this, input, this.key)
  }
}
