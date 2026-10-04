CREATE TABLE publication_snapshots (
  publication_id TEXT PRIMARY KEY REFERENCES publication_revisions(id),
  study_id TEXT NOT NULL REFERENCES studies(id),
  review_id TEXT NOT NULL REFERENCES evidence_review_drafts(id),
  record_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE publication_outputs (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publication_snapshots(publication_id),
  format TEXT NOT NULL CHECK(format IN ('html', 'pdf')),
  state TEXT NOT NULL CHECK(state IN ('queued', 'running', 'released', 'failed')),
  record_json TEXT NOT NULL,
  bytes BLOB,
  UNIQUE(publication_id, format)
);
--> statement-breakpoint
CREATE TRIGGER publication_snapshot_update BEFORE UPDATE ON publication_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER publication_snapshot_delete BEFORE DELETE ON publication_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER publication_output_terminal BEFORE UPDATE ON publication_outputs WHEN OLD.state IN ('released', 'failed') BEGIN SELECT RAISE(ABORT, 'immutable output'); END;
--> statement-breakpoint
CREATE TRIGGER publication_output_delete BEFORE DELETE ON publication_outputs BEGIN SELECT RAISE(ABORT, 'immutable output'); END;
