import * as C from "@reading-studio/contracts"
import type { z } from "zod"

export type Table = {
  readonly name: string
  readonly columns: string
  readonly record?: z.ZodType
  readonly historical?: boolean
}

// This is deliberately a column allowlist, never a database dump or SELECT *.
export const TABLES: readonly Table[] = [
  {
    name: "book_editions",
    columns: "id original_hash original_blob_hash title record_json",
    record: C.BookEdition,
  },
  { name: "studies", columns: "id owner_id edition_id" },
  {
    name: "normalization_revisions",
    columns:
      "id edition_id parent_revision_id? edition_hash parser_version normalizer_version coverage record_json",
    record: C.NormalizationRevision,
  },
  {
    name: "normalization_resources",
    columns: "normalization_revision_id edition_id resource_path position# role status reason?",
  },
  {
    name: "source_blocks",
    columns:
      "normalization_revision_id edition_id resource_path block_id position# text original_fragment? page_label?",
  },
  {
    name: "source_spans",
    columns: "id normalization_revision_id block_id record_json",
    record: C.SourceSpan,
  },
  {
    name: "setup_revisions",
    columns: "id study_id edition_id normalization_revision_id parent_revision_id? record_json",
    record: C.StudySetupRevision,
  },
  { name: "study_forks", columns: "study_id parent_study_id parent_setup_revision_id" },
  {
    name: "transmission_grants",
    columns: "id setup_revision_id installation_id owner_id kind record_json",
    record: C.TransmissionGrant,
  },
  {
    name: "analysis_revisions",
    columns:
      "id edition_id normalization_revision_id parent_revision_id? cache_key status record_json",
    record: C.AnalysisRevision,
  },
  {
    name: "question_revisions",
    columns: "revision_id question_id analysis_revision_id parent_revision_id? record_json",
    record: C.Question,
  },
  { name: "input_revisions", columns: "id study_id parent_revision_id? kind" },
  {
    name: "answer_revisions",
    columns: "id question_revision_id question_id record_json",
    record: C.AnswerSubmission,
  },
  {
    name: "interview_definitions",
    columns: "sequence# id study_id record_json",
    record: C.InterviewDefinition,
  },
  {
    name: "interview_answers",
    columns: "sequence# interview_id question_id record_json",
    record: C.AnswerSubmission,
  },
  {
    name: "brief_drafts",
    columns: "sequence# id study_id setup_revision_id interview_id answer_version# record_json",
    record: C.BriefDraft,
  },
  {
    name: "brief_revisions",
    columns: "id study_id setup_revision_id analysis_revision_id parent_revision_id? record_json",
    record: C.ReadingBrief,
  },
  {
    name: "brief_decisions",
    columns: "sequence# brief_revision_id action decided_at",
    historical: true,
  },
  {
    name: "brief_approvals",
    columns: "brief_revision_id approved_at record_json",
    record: C.ReadingBrief.unwrap().shape.approval,
    historical: true,
  },
  {
    name: "outline_drafts",
    columns: "sequence# id study_id brief_revision_id record_json",
    record: C.OutlineDraft,
  },
  {
    name: "outline_revisions",
    columns:
      "id study_id setup_revision_id analysis_revision_id brief_revision_id parent_revision_id? record_json",
    record: C.StudyOutline,
  },
  {
    name: "outline_decisions",
    columns: "sequence# outline_revision_id action decided_at",
    historical: true,
  },
  {
    name: "outline_approvals",
    columns: "outline_revision_id approved_at record_json",
    record: C.StudyOutline.unwrap().shape.approval,
    historical: true,
  },
  {
    name: "lesson_revisions",
    columns:
      "id study_id setup_revision_id analysis_revision_id brief_revision_id outline_revision_id parent_revision_id? record_json",
    record: C.LessonRevision,
  },
  {
    name: "evidence_reports",
    columns: "hash lesson_revision_id record_json",
    record: C.EvidenceReport,
  },
  {
    name: "evidence_review_drafts",
    columns: "id lesson_revision_id parent_id? record_json",
    record: C.EvidenceDraft,
  },
  {
    name: "privacy_reviews",
    columns: "id projection_hash parent_revision_id? status record_json",
    record: C.PrivacyReview,
    historical: true,
  },
  {
    name: "publication_revisions",
    columns:
      "id lesson_revision_id analysis_revision_id privacy_review_id parent_revision_id? projection_hash record_json",
    record: C.PublicationRevision,
    historical: true,
  },
  {
    name: "publication_approvals",
    columns: "publication_revision_id privacy_review_id projection_hash approved_at record_json",
    record: C.PublicationApproval,
    historical: true,
  },
  {
    name: "publication_snapshots",
    columns: "publication_id study_id review_id record_json",
    record: C.PublicationSnapshot,
    historical: true,
  },
  {
    name: "publication_outputs",
    columns: "id publication_id format state record_json",
    record: C.PublicationOutput,
    historical: true,
  },
  {
    name: "generation_runs",
    columns: "id input_revision_id state reserved_calls# record_json",
    record: C.GenerationRun,
  },
  {
    name: "external_attempts",
    columns: "id run_id input_revision_id state reservation# record_json",
    record: C.ExternalAttempt,
  },
  {
    name: "jobs",
    columns:
      "id run_id input_revision_id setup_revision_id grant_id state checkpoint? cancellation_requested# record_json",
    record: C.Job,
  },
  {
    name: "artifacts",
    columns: "id publication_revision_id job_id content_hash record_json",
    record: C.Artifact,
    historical: true,
  },
  {
    name: "owner_job_decisions",
    columns: "id job_id owner_id setup_revision_id action reason decided_at",
    historical: true,
  },
]
