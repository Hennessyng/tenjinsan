CREATE TABLE full_book_jobs (
 id TEXT PRIMARY KEY NOT NULL, consent_id TEXT NOT NULL REFERENCES full_book_consents(id),
 node_index INTEGER NOT NULL CHECK(node_index>=0), run_id TEXT NOT NULL UNIQUE REFERENCES generation_runs(id),
 state TEXT NOT NULL CHECK(state IN ('queued','running','paused','failed','completed','cancelled')),
 fence INTEGER NOT NULL DEFAULT 0 CHECK(fence>=0), token TEXT, expires_at TEXT, target_hash TEXT,
 repair INTEGER NOT NULL DEFAULT 0 CHECK(repair IN (0,1)), UNIQUE(consent_id,node_index)
);
--> statement-breakpoint
CREATE TABLE full_book_wires (
 attempt_id TEXT PRIMARY KEY NOT NULL REFERENCES external_attempts(id) DEFERRABLE INITIALLY DEFERRED,
 job_id TEXT NOT NULL REFERENCES full_book_jobs(id), ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 2),
 record_json TEXT NOT NULL, UNIQUE(job_id,ordinal),
 CHECK(json_extract(record_json,'$.attemptId')=attempt_id), CHECK(json_extract(record_json,'$.jobId')=job_id),
 CHECK(json_extract(record_json,'$.ordinal')=ordinal), CHECK(json_extract(record_json,'$.transport')='synthetic-only-no-native-entry')
);
--> statement-breakpoint
CREATE TABLE full_book_output_receipts (
 consent_id TEXT NOT NULL REFERENCES full_book_consents(id), node_index INTEGER NOT NULL,
 job_id TEXT NOT NULL UNIQUE REFERENCES full_book_jobs(id), attempt_id TEXT NOT NULL UNIQUE REFERENCES external_attempts(id),
 record_json TEXT NOT NULL, PRIMARY KEY(consent_id,node_index)
);
--> statement-breakpoint
CREATE TABLE full_book_attempt_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL REFERENCES external_attempts(id), record_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE full_book_reply_metadata (
 attempt_id TEXT PRIMARY KEY NOT NULL REFERENCES external_attempts(id), record_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX full_book_reply_turn_unique ON full_book_reply_metadata
 (json_extract(record_json,'$.threadId'),json_extract(record_json,'$.turnId'));
--> statement-breakpoint
CREATE TRIGGER full_book_reply_no_update BEFORE UPDATE ON full_book_reply_metadata
BEGIN SELECT RAISE(ABORT,'received experimental transport metadata is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_reply_no_delete BEFORE DELETE ON full_book_reply_metadata
BEGIN SELECT RAISE(ABORT,'received experimental transport metadata is retained'); END;
--> statement-breakpoint
DROP VIEW full_book_source_commitments;
--> statement-breakpoint
CREATE VIEW full_book_source_commitments AS
SELECT k.owner_id,k.source_hash,
 (SELECT COUNT(DISTINCT a.id) FROM external_attempts a JOIN live_study_scope_jobs j ON j.run_id=a.run_id WHERE j.owner_id=k.owner_id AND j.source_hash=k.source_hash)
 +(SELECT COUNT(a.id) FROM external_attempts a JOIN full_book_jobs j ON j.run_id=a.run_id JOIN full_book_consents c ON c.id=j.consent_id WHERE c.owner_id=k.owner_id AND c.source_hash=k.source_hash) AS spent,
 (SELECT COALESCE(SUM(c.held_calls-(SELECT COUNT(a.id) FROM external_attempts a JOIN full_book_jobs j ON j.run_id=a.run_id WHERE j.consent_id=c.id)),0)
  FROM full_book_active_consents c WHERE c.owner_id=k.owner_id AND c.source_hash=k.source_hash) AS held
FROM (SELECT owner_id,source_hash FROM full_book_consents UNION SELECT owner_id,source_hash FROM live_study_scope_jobs) k;
--> statement-breakpoint
CREATE TRIGGER full_book_job_immutable BEFORE UPDATE ON full_book_jobs
WHEN NEW.id!=OLD.id OR NEW.consent_id!=OLD.consent_id OR NEW.node_index!=OLD.node_index OR NEW.run_id!=OLD.run_id
 OR NEW.fence<OLD.fence OR NEW.fence>OLD.fence+1 OR (OLD.target_hash IS NOT NULL AND NEW.target_hash IS NOT OLD.target_hash)
BEGIN SELECT RAISE(ABORT,'canonical experimental job binding is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_job_no_delete BEFORE DELETE ON full_book_jobs
BEGIN SELECT RAISE(ABORT,'experimental execution history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_wire_no_update BEFORE UPDATE ON full_book_wires
BEGIN SELECT RAISE(ABORT,'experimental wire is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_wire_no_delete BEFORE DELETE ON full_book_wires
BEGIN SELECT RAISE(ABORT,'experimental wire is retained'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_output_no_update BEFORE UPDATE ON full_book_output_receipts
BEGIN SELECT RAISE(ABORT,'experimental output is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_output_no_delete BEFORE DELETE ON full_book_output_receipts
BEGIN SELECT RAISE(ABORT,'experimental output is retained'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_event_no_update BEFORE UPDATE ON full_book_attempt_events
BEGIN SELECT RAISE(ABORT,'experimental event is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_event_no_delete BEFORE DELETE ON full_book_attempt_events
BEGIN SELECT RAISE(ABORT,'experimental event is retained'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_attempt_admission BEFORE INSERT ON external_attempts
WHEN EXISTS(SELECT 1 FROM full_book_jobs j WHERE j.run_id=NEW.run_id) AND NOT EXISTS(
 SELECT 1 FROM full_book_jobs j JOIN full_book_active_consents c ON c.id=j.consent_id JOIN full_book_wires w ON w.job_id=j.id
 JOIN generation_runs r ON r.id=j.run_id WHERE j.run_id=NEW.run_id AND w.attempt_id=NEW.id AND w.ordinal=NEW.reservation
 AND NEW.state='prepared' AND j.state='running' AND json_extract(w.record_json,'$.targetHash')=j.target_hash
 AND json_extract(w.record_json,'$.leaseToken')=j.token AND json_extract(w.record_json,'$.leaseFence')=j.fence
 AND NEW.reservation BETWEEN 1 AND 2 AND r.reserved_calls=NEW.reservation)
BEGIN SELECT RAISE(ABORT,'canonical charged experimental wire required'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_attempt_no_delete BEFORE DELETE ON external_attempts
WHEN EXISTS(SELECT 1 FROM full_book_jobs j WHERE j.run_id=OLD.run_id)
BEGIN SELECT RAISE(ABORT,'experimental charges cannot be refunded'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_attempt_identity BEFORE UPDATE ON external_attempts
WHEN EXISTS(SELECT 1 FROM full_book_jobs j WHERE j.run_id=OLD.run_id) AND
 (NEW.id!=OLD.id OR NEW.run_id!=OLD.run_id OR NEW.input_revision_id!=OLD.input_revision_id OR NEW.reservation!=OLD.reservation OR OLD.state='response-received')
BEGIN SELECT RAISE(ABORT,'experimental received usage and attempt identity are retained'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_output_admission BEFORE INSERT ON full_book_output_receipts
WHEN NOT EXISTS(SELECT 1 FROM full_book_jobs j JOIN full_book_active_consents c ON c.id=j.consent_id JOIN full_book_wires w ON w.job_id=j.id JOIN external_attempts a ON a.id=w.attempt_id
 JOIN full_book_reply_metadata m ON m.attempt_id=a.id
 WHERE j.id=NEW.job_id AND j.consent_id=NEW.consent_id AND j.node_index=NEW.node_index AND j.state='running'
 AND a.id=NEW.attempt_id AND a.state='response-received' AND json_extract(w.record_json,'$.targetHash')=j.target_hash
 AND json_extract(m.record_json,'$.terminal')='completed' AND json_extract(m.record_json,'$.wireHash')=json_extract(w.record_json,'$.hash')
 AND c.setup_revision_id=(SELECT s.id FROM setup_revisions s WHERE s.study_id=c.study_id ORDER BY s.rowid DESC LIMIT 1)
 AND COALESCE((SELECT revision FROM subscription_connections r WHERE r.installation_id=json_extract(c.record_json,'$.session.destination.installationId') AND r.provider='chatgpt-subscription'),0)=json_extract(c.record_json,'$.session.destination.connectionRevision'))
BEGIN SELECT RAISE(ABORT,'received canonical output binding required'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_no_ordinary_job BEFORE INSERT ON jobs
WHEN EXISTS(SELECT 1 FROM full_book_jobs j WHERE j.run_id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'experimental runs cannot enter ordinary jobs'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_legacy_twenty BEFORE INSERT ON external_attempts
WHEN EXISTS(SELECT 1 FROM live_study_scope_jobs j JOIN full_book_source_commitments u ON u.owner_id=j.owner_id AND u.source_hash=j.source_hash
 WHERE j.run_id=NEW.run_id AND u.spent>=20 AND EXISTS(SELECT 1 FROM full_book_consents c WHERE c.owner_id=j.owner_id AND c.source_hash=j.source_hash))
BEGIN SELECT RAISE(ABORT,'old grants retain the cumulative twenty-slot ceiling'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_maintenance_drain BEFORE UPDATE ON maintenance_gate
WHEN NEW.phase='frozen' AND EXISTS(SELECT 1 FROM external_attempts a JOIN full_book_jobs j ON j.run_id=a.run_id WHERE a.state IN ('prepared','dispatching'))
BEGIN SELECT RAISE(ABORT,'experimental attempts must settle before maintenance'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_pending_source_version BEFORE INSERT ON full_book_consents
WHEN EXISTS(SELECT 1 FROM full_book_consents c JOIN full_book_jobs j ON j.consent_id=c.id JOIN external_attempts a ON a.run_id=j.run_id
 WHERE c.owner_id=NEW.owner_id AND c.source_hash=NEW.source_hash AND (a.state IN ('prepared','dispatching') OR
 (a.state='outcome_unknown' AND json_extract(a.record_json,'$.resolution')='awaiting-owner')))
BEGIN SELECT RAISE(ABORT,'unresolved experimental attempt requires an owner decision'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_run_ownership BEFORE INSERT ON full_book_jobs
WHEN EXISTS(SELECT 1 FROM jobs j WHERE j.run_id=NEW.run_id) OR NEW.run_id!='fb-'||NEW.id OR NEW.fence!=0 OR NEW.state!='queued'
 OR NOT EXISTS(SELECT 1 FROM full_book_active_consents c JOIN generation_runs r ON r.id=NEW.run_id
 WHERE c.id=NEW.consent_id AND NEW.node_index<json_array_length(c.record_json,'$.session.plan.nodes') AND r.input_revision_id='fb-input-'||c.id)
BEGIN SELECT RAISE(ABORT,'canonical exclusive experimental run required'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_dispatch_authority BEFORE UPDATE ON external_attempts
WHEN NEW.state='dispatching' AND EXISTS(SELECT 1 FROM full_book_jobs j WHERE j.run_id=NEW.run_id) AND NOT EXISTS(
 SELECT 1 FROM full_book_jobs j JOIN full_book_active_consents c ON c.id=j.consent_id JOIN full_book_wires w ON w.attempt_id=NEW.id
 WHERE j.run_id=NEW.run_id AND j.state='running' AND json_extract(w.record_json,'$.leaseToken')=j.token
 AND json_extract(w.record_json,'$.leaseFence')=j.fence AND json_extract(w.record_json,'$.targetHash')=j.target_hash
 AND c.setup_revision_id=(SELECT s.id FROM setup_revisions s WHERE s.study_id=c.study_id ORDER BY s.rowid DESC LIMIT 1)
 AND COALESCE((SELECT revision FROM subscription_connections r WHERE r.installation_id=json_extract(c.record_json,'$.session.destination.installationId') AND r.provider='chatgpt-subscription'),0)=json_extract(c.record_json,'$.session.destination.connectionRevision'))
BEGIN SELECT RAISE(ABORT,'current experimental dispatch authority required'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_run_counter BEFORE UPDATE ON generation_runs
WHEN EXISTS(SELECT 1 FROM full_book_jobs j WHERE j.run_id=OLD.id) AND
 (NEW.id!=OLD.id OR NEW.input_revision_id!=OLD.input_revision_id OR NEW.reserved_calls<OLD.reserved_calls OR NEW.reserved_calls>OLD.reserved_calls+1 OR NEW.reserved_calls>2
 OR (NEW.reserved_calls=OLD.reserved_calls+1 AND NOT EXISTS(SELECT 1 FROM full_book_wires w JOIN full_book_jobs j ON j.id=w.job_id WHERE j.run_id=OLD.id AND w.ordinal=NEW.reserved_calls)))
BEGIN SELECT RAISE(ABORT,'experimental run counter is finite and monotonic'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_claim_order BEFORE UPDATE ON full_book_jobs
WHEN NEW.state='running' AND OLD.state!='running' AND
 (NEW.node_index!=(SELECT COUNT(*) FROM full_book_output_receipts o WHERE o.consent_id=NEW.consent_id)
 OR NEW.fence!=OLD.fence+1 OR NEW.token IS NULL OR NEW.expires_at IS NULL)
BEGIN SELECT RAISE(ABORT,'only the next canonical fenced experimental job is claimable'); END;
--> statement-breakpoint
CREATE VIEW full_book_unresolved_sources AS
SELECT DISTINCT c.owner_id,c.source_hash FROM full_book_consents c JOIN full_book_jobs j ON j.consent_id=c.id JOIN external_attempts a ON a.run_id=j.run_id
WHERE a.state IN ('prepared','dispatching') OR (a.state='outcome_unknown' AND json_extract(a.record_json,'$.resolution')='awaiting-owner');
--> statement-breakpoint
CREATE TRIGGER full_book_unresolved_legacy_claim BEFORE UPDATE ON jobs
WHEN NEW.state='running' AND EXISTS(SELECT 1 FROM live_study_scope_jobs j JOIN full_book_unresolved_sources u ON u.owner_id=j.owner_id AND u.source_hash=j.source_hash WHERE j.job_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'unresolved experimental source work blocks ordinary claims'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_unresolved_legacy_attempt BEFORE INSERT ON external_attempts
WHEN EXISTS(SELECT 1 FROM live_study_scope_jobs j JOIN full_book_unresolved_sources u ON u.owner_id=j.owner_id AND u.source_hash=j.source_hash WHERE j.run_id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'unresolved experimental source work blocks ordinary attempts'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_unresolved_legacy_dispatch BEFORE UPDATE ON external_attempts
WHEN NEW.state='dispatching' AND EXISTS(SELECT 1 FROM live_study_scope_jobs j JOIN full_book_unresolved_sources u ON u.owner_id=j.owner_id AND u.source_hash=j.source_hash WHERE j.run_id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'unresolved experimental source work blocks ordinary dispatch'); END;
