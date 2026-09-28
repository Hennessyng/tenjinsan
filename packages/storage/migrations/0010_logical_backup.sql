CREATE TABLE backup_history (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  study_id TEXT REFERENCES studies(id),
  edition_id TEXT REFERENCES book_editions(id),
  record_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER backup_history_no_update BEFORE UPDATE ON backup_history
BEGIN SELECT RAISE(ABORT, 'immutable historical provenance'); END;
--> statement-breakpoint
CREATE TRIGGER backup_history_no_delete BEFORE DELETE ON backup_history
BEGIN SELECT RAISE(ABORT, 'immutable historical provenance'); END;
