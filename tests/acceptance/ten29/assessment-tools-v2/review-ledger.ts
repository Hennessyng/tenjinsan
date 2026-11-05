import { coverageMatchesConstructed } from "./coverage-check.ts"
import { CoverageAdjudication, HumanCoverage } from "./coverage-schema.ts"
import { digest } from "./integrity.ts"
import {
  Adjudication,
  AdjudicatorEnrollment,
  type Assessment,
  type Enrollment,
  type Manifest,
  Reference,
} from "./workflow-schema.ts"
export class ReviewLedger {
  private readonly references = new Map<string, Reference>()
  private readonly adjudications = new Map<string, Adjudication>()
  private readonly coverage = new Map<string, HumanCoverage>()
  private readonly coverageAdjudications = new Map<string, CoverageAdjudication>()
  private adjudicator: AdjudicatorEnrollment | null = null
  private primarySnapshot: {
    readonly firstPassesDigest: string
    readonly constructedLabelsDigest: string
  } | null = null
  constructor(
    private readonly context: { readonly manifest: Manifest; readonly enrollment: Enrollment },
  ) {}
  private actor(
    value: { readonly packetDigest: string; readonly mode: string; readonly humanId: string },
    secondary = false,
  ) {
    const actor = secondary ? this.adjudicator : this.context.enrollment
    if (
      !actor ||
      value.packetDigest !== this.context.manifest.packetDigest ||
      value.mode !== actor.mode ||
      value.humanId !== actor.humanId
    )
      throw new TypeError(
        secondary ? "Different independent human adjudicator required" : "Wrong actor/packet/mode",
      )
  }
  unblind(assessments: ReadonlyMap<string, Assessment>) {
    const expected = this.context.manifest.documents.flatMap((row) => row.candidates)
    if (this.primarySnapshot || assessments.size !== expected.length)
      throw new TypeError("Unblinding requires all immutable blind first passes")
    this.primarySnapshot = {
      firstPassesDigest: digest(
        expected.map((candidate) => assessments.get(candidate.candidateCode)),
      ),
      constructedLabelsDigest: digest(
        expected.map((candidate) => ({
          candidateCode: candidate.candidateCode,
          constructed: candidate.constructed,
        })),
      ),
    }
    return this.primarySnapshot
  }
  authorize(input: unknown) {
    const value = AdjudicatorEnrollment.parse(input),
      { manifest, enrollment } = this.context
    const dispute =
      [...this.references.values()].some((row) => row.disposition === "dispute") ||
      [...this.coverage.values()].some((row) => {
        const document = manifest.documents.find((entry) => entry.documentCode === row.documentCode)
        return !!document && !coverageMatchesConstructed(document, row)
      })
    if (
      !dispute ||
      this.adjudicator ||
      value.packetDigest !== manifest.packetDigest ||
      value.mode !== enrollment.mode ||
      value.humanId === enrollment.humanId ||
      value.humanId === enrollment.coordinatorId
    )
      throw new TypeError("A different approved independent human is needed only for a dispute")
    this.adjudicator = value
    return value
  }
  submitReference(input: unknown, assessments: ReadonlyMap<string, Assessment>) {
    const value = Reference.parse(input)
    this.actor(value)
    const { manifest } = this.context,
      expected = manifest.documents.flatMap((row) => row.candidates),
      candidate = expected.find((row) => row.candidateCode === value.candidateCode),
      assessment = assessments.get(value.candidateCode)
    if (
      !this.primarySnapshot ||
      assessments.size !== expected.length ||
      !candidate ||
      !assessment ||
      this.references.has(value.candidateCode) ||
      digest(assessment) !== value.firstPassDigest ||
      digest(candidate.constructed) !== value.constructedLabelDigest ||
      Date.parse(value.completedAt) < Date.parse(assessment.completedAt)
    )
      throw new TypeError(
        "Corroboration requires unblinded sealed primary result and constructed label",
      )
    this.references.set(value.candidateCode, value)
    return value
  }
  adjudicate(input: unknown) {
    const value = Adjudication.parse(input)
    this.actor(value, true)
    const reference = this.references.get(value.candidateCode),
      document = this.context.manifest.documents.find((row) =>
        row.candidates.some((candidate) => candidate.candidateCode === value.candidateCode),
      )
    if (
      !reference ||
      reference.disposition !== "dispute" ||
      !document ||
      this.coverage.has(document.documentCode) ||
      this.adjudications.has(value.candidateCode) ||
      digest(reference) !== value.referenceDigest ||
      Date.parse(value.completedAt) < Date.parse(reference.completedAt) ||
      (value.label === "unresolved") !== (value.criticalNegative === null) ||
      (value.label === "faithful" && value.criticalNegative !== false)
    )
      throw new TypeError("Wrong or duplicate independent adjudication")
    this.adjudications.set(value.candidateCode, value)
    return value
  }
  confirmCoverage(input: unknown) {
    const value = HumanCoverage.parse(input)
    this.actor(value)
    const document = this.context.manifest.documents.find(
      (row) => row.documentCode === value.documentCode,
    )
    if (
      !document ||
      this.coverage.has(value.documentCode) ||
      document.candidates.some((candidate) => !this.references.has(candidate.candidateCode))
    )
      throw new TypeError("Coverage requires complete corroboration")
    const records = document.candidates.map((candidate) => ({
      reference: this.references.get(candidate.candidateCode),
      adjudication: this.adjudications.get(candidate.candidateCode) ?? null,
    }))
    if (
      digest(records) !== value.referenceSetDigest ||
      value.rows.some((row) =>
        row.candidateCodes.some(
          (code) => !document.candidates.some((candidate) => candidate.candidateCode === code),
        ),
      ) ||
      records.some(
        (row) =>
          Date.parse(row.adjudication?.completedAt ?? row.reference?.completedAt ?? "") >
          Date.parse(value.completedAt),
      )
    )
      throw new TypeError("Wrong coverage references/chronology")
    this.coverage.set(value.documentCode, value)
    return value
  }
  adjudicateCoverage(input: unknown) {
    const value = CoverageAdjudication.parse(input)
    this.actor(value, true)
    const coverage = this.coverage.get(value.documentCode),
      document = this.context.manifest.documents.find(
        (row) => row.documentCode === value.documentCode,
      )
    if (
      !coverage ||
      !document ||
      coverageMatchesConstructed(document, coverage) ||
      this.coverageAdjudications.has(value.documentCode) ||
      digest(coverage) !== value.coverageDigest ||
      Date.parse(value.completedAt) < Date.parse(coverage.completedAt)
    )
      throw new TypeError("Wrong coverage dispute adjudication")
    this.coverageAdjudications.set(value.documentCode, value)
    return value
  }
  snapshot() {
    return structuredClone({
      references: [...this.references.values()],
      adjudications: [...this.adjudications.values()],
      coverage: [...this.coverage.values()],
      coverageAdjudications: [...this.coverageAdjudications.values()],
      adjudicator: this.adjudicator,
      primarySnapshot: this.primarySnapshot,
    })
  }
}
