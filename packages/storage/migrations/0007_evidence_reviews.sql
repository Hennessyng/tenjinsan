CREATE TABLE evidence_review_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  lesson_revision_id TEXT NOT NULL REFERENCES lesson_revisions(id),
  parent_id TEXT REFERENCES evidence_review_drafts(id),
  record_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX evidence_review_lesson ON evidence_review_drafts(lesson_revision_id);
--> statement-breakpoint
CREATE TRIGGER evidence_review_no_update BEFORE UPDATE ON evidence_review_drafts
BEGIN SELECT RAISE(ABORT, 'immutable evidence review'); END;
--> statement-breakpoint
CREATE TRIGGER evidence_review_no_delete BEFORE DELETE ON evidence_review_drafts
BEGIN SELECT RAISE(ABORT, 'immutable evidence review'); END;
