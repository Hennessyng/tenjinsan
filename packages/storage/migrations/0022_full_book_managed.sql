CREATE TABLE full_book_managed_consents (
 id TEXT PRIMARY KEY NOT NULL, budget_consent_id TEXT NOT NULL REFERENCES full_book_consents(id), record_json TEXT NOT NULL,
 CHECK(json_extract(record_json,'$.id')=id AND json_extract(record_json,'$.budgetConsentId')=budget_consent_id),
 CHECK(json_extract(record_json,'$.purpose')='full-book-managed-experimental')
);
--> statement-breakpoint
CREATE TABLE full_book_managed_revocations (consent_id TEXT PRIMARY KEY NOT NULL REFERENCES full_book_managed_consents(id),reason TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE full_book_managed_frames (
 attempt_id TEXT PRIMARY KEY NOT NULL REFERENCES external_attempts(id), consent_id TEXT NOT NULL REFERENCES full_book_managed_consents(id), record_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE full_book_managed_threads (attempt_id TEXT PRIMARY KEY NOT NULL REFERENCES external_attempts(id),consent_id TEXT NOT NULL REFERENCES full_book_managed_consents(id),record_json TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE full_book_managed_failures (attempt_id TEXT PRIMARY KEY NOT NULL REFERENCES external_attempts(id),consent_id TEXT NOT NULL REFERENCES full_book_managed_consents(id),record_json TEXT NOT NULL);
--> statement-breakpoint
CREATE TRIGGER managed_failure_no_update BEFORE UPDATE ON full_book_managed_failures BEGIN SELECT RAISE(ABORT,'managed failure evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER managed_failure_no_delete BEFORE DELETE ON full_book_managed_failures BEGIN SELECT RAISE(ABORT,'managed failure evidence is retained'); END;
--> statement-breakpoint
CREATE TRIGGER managed_thread_no_update BEFORE UPDATE ON full_book_managed_threads BEGIN SELECT RAISE(ABORT,'managed thread frame is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER managed_thread_no_delete BEFORE DELETE ON full_book_managed_threads BEGIN SELECT RAISE(ABORT,'managed thread frame is retained'); END;
--> statement-breakpoint
CREATE TRIGGER managed_consent_no_update BEFORE UPDATE ON full_book_managed_consents BEGIN SELECT RAISE(ABORT,'managed consent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER managed_consent_no_delete BEFORE DELETE ON full_book_managed_consents BEGIN SELECT RAISE(ABORT,'managed consent is retained'); END;
--> statement-breakpoint
CREATE TRIGGER managed_revoke_no_update BEFORE UPDATE ON full_book_managed_revocations BEGIN SELECT RAISE(ABORT,'managed revocation is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER managed_revoke_no_delete BEFORE DELETE ON full_book_managed_revocations BEGIN SELECT RAISE(ABORT,'managed revocation is retained'); END;
--> statement-breakpoint
CREATE TRIGGER managed_frame_no_update BEFORE UPDATE ON full_book_managed_frames BEGIN SELECT RAISE(ABORT,'managed frame is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER managed_frame_no_delete BEFORE DELETE ON full_book_managed_frames BEGIN SELECT RAISE(ABORT,'managed frame is retained'); END;
--> statement-breakpoint
CREATE UNIQUE INDEX managed_fresh_thread ON full_book_managed_frames(json_extract(record_json,'$.freshThreadId'));
--> statement-breakpoint
DROP TRIGGER full_book_output_admission;
--> statement-breakpoint
CREATE TRIGGER full_book_output_admission BEFORE INSERT ON full_book_output_receipts
WHEN NOT EXISTS(SELECT 1 FROM full_book_jobs j JOIN full_book_active_consents c ON c.id=j.consent_id JOIN full_book_wires w ON w.job_id=j.id JOIN external_attempts a ON a.id=w.attempt_id
 JOIN full_book_reply_metadata m ON m.attempt_id=a.id WHERE j.id=NEW.job_id AND j.consent_id=NEW.consent_id AND j.node_index=NEW.node_index AND j.state='running'
 AND a.id=NEW.attempt_id AND a.state='response-received' AND json_extract(w.record_json,'$.targetHash')=j.target_hash AND json_extract(m.record_json,'$.terminal')='completed'
 AND ((json_extract(m.record_json,'$.transport')='synthetic-only-no-native-entry' AND json_extract(m.record_json,'$.wireHash')=json_extract(w.record_json,'$.hash')) OR
 (json_extract(m.record_json,'$.transport')='managed-experimental-app-bounded' AND EXISTS(SELECT 1 FROM full_book_managed_frames f JOIN full_book_managed_consents n ON n.id=f.consent_id
 WHERE f.attempt_id=a.id AND n.budget_consent_id=c.id AND json_extract(m.record_json,'$.wireHash')=json_extract(f.record_json,'$.turn.sha256')
 AND NOT EXISTS(SELECT 1 FROM full_book_managed_revocations r WHERE r.consent_id=n.id))))
 AND c.setup_revision_id=(SELECT s.id FROM setup_revisions s WHERE s.study_id=c.study_id ORDER BY s.rowid DESC LIMIT 1)
 AND COALESCE((SELECT revision FROM subscription_connections r WHERE r.installation_id=json_extract(c.record_json,'$.session.destination.installationId') AND r.provider='chatgpt-subscription'),0)=json_extract(c.record_json,'$.session.destination.connectionRevision'))
BEGIN SELECT RAISE(ABORT,'received canonical authorized output required'); END;
