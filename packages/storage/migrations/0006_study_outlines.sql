CREATE TABLE outline_drafts (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 study_id TEXT NOT NULL REFERENCES studies(id),
 brief_revision_id TEXT NOT NULL REFERENCES brief_revisions(id),
 record_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE outline_decisions (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 outline_revision_id TEXT NOT NULL REFERENCES outline_drafts(id),
 action TEXT NOT NULL CHECK(action IN ('approve', 'revise', 'defer')),
 decided_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE VIEW current_outline_status AS
SELECT d.id, d.study_id, d.brief_revision_id,
 CASE WHEN NOT EXISTS (SELECT 1 FROM current_brief_status b WHERE b.id = d.brief_revision_id AND b.status = 'approved') THEN 'outdated'
 ELSE COALESCE((SELECT CASE action WHEN 'approve' THEN 'approved' ELSE action END FROM outline_decisions WHERE outline_revision_id = d.id ORDER BY sequence DESC LIMIT 1), 'pending') END AS status
FROM outline_drafts d WHERE d.sequence = (SELECT MAX(sequence) FROM outline_drafts WHERE study_id = d.study_id);
--> statement-breakpoint
CREATE TRIGGER outline_drafts_no_update BEFORE UPDATE ON outline_drafts BEGIN SELECT RAISE(ABORT, 'immutable outline draft'); END;
--> statement-breakpoint
CREATE TRIGGER outline_drafts_no_delete BEFORE DELETE ON outline_drafts BEGIN SELECT RAISE(ABORT, 'immutable outline draft'); END;
--> statement-breakpoint
CREATE TRIGGER outline_decisions_no_update BEFORE UPDATE ON outline_decisions BEGIN SELECT RAISE(ABORT, 'immutable outline decision'); END;
--> statement-breakpoint
CREATE TRIGGER outline_decisions_no_delete BEFORE DELETE ON outline_decisions BEGIN SELECT RAISE(ABORT, 'immutable outline decision'); END;
--> statement-breakpoint
CREATE TRIGGER lesson_requires_current_outline BEFORE INSERT ON lesson_revisions
WHEN EXISTS (SELECT 1 FROM outline_drafts WHERE id = NEW.outline_revision_id)
AND NOT EXISTS (SELECT 1 FROM current_outline_status WHERE id = NEW.outline_revision_id AND status = 'approved')
BEGIN SELECT RAISE(ABORT, 'current outline approval required'); END;
--> statement-breakpoint
CREATE TRIGGER section_jobs_require_outline BEFORE INSERT ON jobs
WHEN json_extract(NEW.record_json, '$.stage') = 'lesson'
AND NOT EXISTS (SELECT 1 FROM outline_revisions o JOIN outline_approvals a ON a.outline_revision_id = o.id WHERE o.id = NEW.input_revision_id AND o.setup_revision_id = NEW.setup_revision_id
 AND (NOT EXISTS (SELECT 1 FROM outline_drafts WHERE id = o.id) OR EXISTS (SELECT 1 FROM current_outline_status WHERE id = o.id AND status = 'approved')))
BEGIN SELECT RAISE(ABORT, 'current outline approval required'); END;
