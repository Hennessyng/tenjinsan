CREATE TABLE interview_definitions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  study_id TEXT NOT NULL REFERENCES studies(id),
  record_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE interview_answers (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id TEXT NOT NULL REFERENCES interview_definitions(id),
  question_id TEXT NOT NULL,
  record_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER interview_definitions_immutable_update BEFORE UPDATE ON interview_definitions BEGIN SELECT RAISE(ABORT, 'immutable interview'); END;
--> statement-breakpoint
CREATE TRIGGER interview_definitions_immutable_delete BEFORE DELETE ON interview_definitions BEGIN SELECT RAISE(ABORT, 'immutable interview'); END;
--> statement-breakpoint
CREATE TRIGGER interview_answers_immutable_update BEFORE UPDATE ON interview_answers BEGIN SELECT RAISE(ABORT, 'immutable answer'); END;
--> statement-breakpoint
CREATE TRIGGER interview_answers_immutable_delete BEFORE DELETE ON interview_answers BEGIN SELECT RAISE(ABORT, 'immutable answer'); END;
