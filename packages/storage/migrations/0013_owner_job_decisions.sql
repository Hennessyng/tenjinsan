CREATE TABLE owner_job_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  owner_id TEXT NOT NULL,
  setup_revision_id TEXT NOT NULL REFERENCES setup_revisions(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('cancel', 'retry', 'stop-approved', 'retry-approved')),
  reason TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER owner_job_decisions_no_update BEFORE UPDATE ON owner_job_decisions BEGIN SELECT RAISE(ABORT, 'immutable decision'); END;
--> statement-breakpoint
CREATE TRIGGER owner_job_decisions_no_delete BEFORE DELETE ON owner_job_decisions BEGIN SELECT RAISE(ABORT, 'immutable decision'); END;
