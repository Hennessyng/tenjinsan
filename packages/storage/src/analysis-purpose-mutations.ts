import type Database from "better-sqlite3"

export function installAnalysisPurposeMutationGuards(sqlite: Database.Database) {
  const study = (id: string) =>
    `(SELECT json_extract(s.record_json,'$.analysis.purpose.version') FROM setup_revisions s WHERE s.study_id=${id} ORDER BY rowid DESC LIMIT 1)='analysis-evaluation-1'`
  const setup = (id: string) =>
    `EXISTS(SELECT 1 FROM setup_revisions s WHERE s.id=${id} AND json_extract(s.record_json,'$.analysis.purpose.version')='analysis-evaluation-1')`
  const analysis = (id: string) =>
    `EXISTS(SELECT 1 FROM analysis_revisions a WHERE a.id=${id} AND json_extract(a.record_json,'$.cacheInput.purpose.version')='analysis-evaluation-1')`
  const lesson = (id: string) =>
    `EXISTS(SELECT 1 FROM lesson_revisions l WHERE l.id=${id} AND (${study("l.study_id")} OR ${setup("l.setup_revision_id")}))`
  const publication = (id: string) =>
    `EXISTS(SELECT 1 FROM publication_snapshots p WHERE p.publication_id=${id} AND ${study("p.study_id")}) OR EXISTS(SELECT 1 FROM publication_revisions p WHERE p.id=${id} AND ${lesson("p.lesson_revision_id")})`
  const guarded = [
    ["input_revisions", `NEW.kind!='setup' AND ${study("NEW.study_id")}`],
    ["interview_definitions", study("NEW.study_id")],
    [
      "interview_answers",
      `EXISTS(SELECT 1 FROM interview_definitions i WHERE i.id=NEW.interview_id AND ${study("i.study_id")})`,
    ],
    ["question_revisions", analysis("NEW.analysis_revision_id")],
    [
      "answer_revisions",
      `EXISTS(SELECT 1 FROM question_revisions q WHERE q.revision_id=NEW.question_revision_id AND ${analysis("q.analysis_revision_id")})`,
    ],
    ...[
      "brief_drafts",
      "brief_revisions",
      "outline_drafts",
      "outline_revisions",
      "lesson_revisions",
      "publication_snapshots",
    ].map((table) => [table, study("NEW.study_id")]),
    ["evidence_reports", lesson("NEW.lesson_revision_id")],
    ["evidence_review_drafts", lesson("NEW.lesson_revision_id")],
    [
      "publication_revisions",
      `${lesson("NEW.lesson_revision_id")} OR ${analysis("NEW.analysis_revision_id")}`,
    ],
    ["publication_outputs", publication("NEW.publication_id")],
    ["artifacts", publication("NEW.publication_revision_id")],
    [
      "setup_revisions",
      `(json_extract(NEW.record_json,'$.analysis.purpose.version')='analysis-evaluation-1' AND EXISTS(SELECT 1 FROM setup_revisions s WHERE s.study_id=NEW.study_id)) OR ${study("NEW.study_id")}`,
    ],
    [
      "transmission_grants",
      `${setup("NEW.setup_revision_id")} AND (json_extract(NEW.record_json,'$.purpose.version') IS NOT 'analysis-evaluation-1' OR json_extract(NEW.record_json,'$.purpose.terminal') IS NOT 'verified-analysis' OR NEW.id!='grant-'||NEW.setup_revision_id OR json_array_length(NEW.record_json,'$.categories')!=2 OR NOT EXISTS(SELECT 1 FROM json_each(NEW.record_json,'$.categories') WHERE value='book-text') OR NOT EXISTS(SELECT 1 FROM json_each(NEW.record_json,'$.categories') WHERE value='derived-study-material'))`,
    ],
  ]
  for (const [table, condition] of guarded)
    for (const action of ["INSERT", "UPDATE"] as const)
      sqlite.exec(
        `CREATE TRIGGER IF NOT EXISTS analysis_purpose_${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT,'analysis-evaluation-purpose'); END`,
      )
}
export function isAnalysisPurposeFailure(error: unknown): boolean {
  let value = error
  for (let depth = 0; depth < 4 && value instanceof Error; depth++) {
    if (value.message.includes("analysis-evaluation-purpose")) return true
    value = value.cause
  }
  return false
}
