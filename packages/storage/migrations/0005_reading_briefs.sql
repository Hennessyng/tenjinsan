CREATE TABLE brief_drafts (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE REFERENCES input_revisions(id),
  study_id TEXT NOT NULL REFERENCES studies(id),
  setup_revision_id TEXT NOT NULL REFERENCES setup_revisions(id),
  interview_id TEXT NOT NULL REFERENCES interview_definitions(id),
  answer_version INTEGER NOT NULL,
  record_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE brief_decisions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  brief_revision_id TEXT NOT NULL REFERENCES brief_drafts(id),
  action TEXT NOT NULL CHECK(action IN ('approve', 'revise', 'defer')),
  decided_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE VIEW current_brief_status AS
SELECT d.id, d.study_id, d.setup_revision_id,
 CASE WHEN d.interview_id != (SELECT id FROM interview_definitions WHERE study_id = d.study_id ORDER BY sequence DESC LIMIT 1)
 OR d.setup_revision_id != (SELECT id FROM setup_revisions WHERE study_id = d.study_id ORDER BY rowid DESC LIMIT 1)
 OR d.answer_version != (SELECT COALESCE(MAX(sequence), 0) FROM interview_answers WHERE interview_id = d.interview_id)
 THEN 'outdated'
 ELSE COALESCE((SELECT CASE action WHEN 'approve' THEN 'approved' ELSE action END FROM brief_decisions WHERE brief_revision_id = d.id ORDER BY sequence DESC LIMIT 1), 'pending') END AS status
FROM brief_drafts d WHERE d.sequence = (SELECT MAX(sequence) FROM brief_drafts WHERE study_id = d.study_id);
--> statement-breakpoint
CREATE TRIGGER brief_drafts_no_update BEFORE UPDATE ON brief_drafts BEGIN SELECT RAISE(ABORT, 'immutable brief draft'); END;
--> statement-breakpoint
CREATE TRIGGER brief_drafts_no_delete BEFORE DELETE ON brief_drafts BEGIN SELECT RAISE(ABORT, 'immutable brief draft'); END;
--> statement-breakpoint
CREATE TRIGGER brief_decisions_no_update BEFORE UPDATE ON brief_decisions BEGIN SELECT RAISE(ABORT, 'immutable brief decision'); END;
--> statement-breakpoint
CREATE TRIGGER brief_decisions_no_delete BEFORE DELETE ON brief_decisions BEGIN SELECT RAISE(ABORT, 'immutable brief decision'); END;
--> statement-breakpoint
CREATE TRIGGER outline_jobs_require_brief BEFORE INSERT ON jobs
WHEN json_extract(NEW.record_json, '$.stage') = 'outline'
AND NOT EXISTS (SELECT 1 FROM current_brief_status WHERE id = NEW.input_revision_id AND setup_revision_id = NEW.setup_revision_id AND status = 'approved')
BEGIN SELECT RAISE(ABORT, 'current brief approval required'); END;
--> statement-breakpoint
CREATE TRIGGER outline_requires_current_brief BEFORE INSERT ON outline_revisions
WHEN EXISTS (SELECT 1 FROM brief_drafts WHERE id = NEW.brief_revision_id)
AND NOT EXISTS (SELECT 1 FROM current_brief_status WHERE id = NEW.brief_revision_id AND status = 'approved')
BEGIN SELECT RAISE(ABORT, 'current brief approval required'); END;
--> statement-breakpoint
CREATE TRIGGER lesson_requires_current_brief BEFORE INSERT ON lesson_revisions
WHEN EXISTS (SELECT 1 FROM brief_drafts WHERE id = NEW.brief_revision_id)
AND NOT EXISTS (SELECT 1 FROM current_brief_status WHERE id = NEW.brief_revision_id AND status = 'approved')
BEGIN SELECT RAISE(ABORT, 'current brief approval required'); END;
--> statement-breakpoint
CREATE TRIGGER publication_requires_current_brief BEFORE INSERT ON publication_revisions
WHEN EXISTS (SELECT 1 FROM lesson_revisions l JOIN brief_drafts d ON l.brief_revision_id = d.id WHERE l.id = NEW.lesson_revision_id)
AND NOT EXISTS (SELECT 1 FROM lesson_revisions l JOIN current_brief_status c ON l.brief_revision_id = c.id WHERE l.id = NEW.lesson_revision_id AND c.status = 'approved')
BEGIN SELECT RAISE(ABORT, 'current brief approval required'); END;
--> statement-breakpoint
CREATE TRIGGER artifact_requires_current_brief BEFORE INSERT ON artifacts
WHEN EXISTS (SELECT 1 FROM publication_revisions p JOIN lesson_revisions l ON p.lesson_revision_id = l.id JOIN brief_drafts d ON l.brief_revision_id = d.id WHERE p.id = NEW.publication_revision_id)
AND NOT EXISTS (SELECT 1 FROM publication_revisions p JOIN lesson_revisions l ON p.lesson_revision_id = l.id JOIN current_brief_status c ON l.brief_revision_id = c.id WHERE p.id = NEW.publication_revision_id AND c.status = 'approved')
BEGIN SELECT RAISE(ABORT, 'current brief approval required'); END;
--> statement-breakpoint
CREATE TRIGGER evidence_requires_current_brief BEFORE INSERT ON evidence_reports
WHEN EXISTS (SELECT 1 FROM lesson_revisions l JOIN brief_drafts d ON l.brief_revision_id = d.id WHERE l.id = NEW.lesson_revision_id)
AND NOT EXISTS (SELECT 1 FROM lesson_revisions l JOIN current_brief_status c ON l.brief_revision_id = c.id WHERE l.id = NEW.lesson_revision_id AND c.status = 'approved')
BEGIN SELECT RAISE(ABORT, 'current brief approval required'); END;
