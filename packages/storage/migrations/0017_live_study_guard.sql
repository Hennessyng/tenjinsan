CREATE TABLE `live_study_guards` (
  `authorization_id` text PRIMARY KEY NOT NULL,
  `study_id` text NOT NULL UNIQUE,
  `setup_revision_id` text NOT NULL UNIQUE,
  `target_json` text NOT NULL,
  `setup_hash` text NOT NULL,
  `attempt_limit` integer NOT NULL CHECK (`attempt_limit` = 20),
  `reserved_calls` integer NOT NULL DEFAULT 0 CHECK (`reserved_calls` >= 0 AND `reserved_calls` <= 20)
);
--> statement-breakpoint
CREATE TRIGGER live_study_guard_immutable_update BEFORE UPDATE ON live_study_guards
WHEN NEW.authorization_id != OLD.authorization_id OR NEW.study_id != OLD.study_id
  OR NEW.setup_revision_id != OLD.setup_revision_id OR NEW.target_json != OLD.target_json
  OR NEW.setup_hash != OLD.setup_hash OR NEW.attempt_limit != OLD.attempt_limit
  OR NEW.reserved_calls != OLD.reserved_calls + 1
BEGIN SELECT RAISE(ABORT, 'live study authorization is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER live_study_guard_immutable_delete BEFORE DELETE ON live_study_guards
BEGIN SELECT RAISE(ABORT, 'live study authorization is immutable'); END;
