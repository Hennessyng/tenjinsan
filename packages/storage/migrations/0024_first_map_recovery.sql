CREATE TABLE full_book_recoveries (
 id TEXT PRIMARY KEY NOT NULL, consent_id TEXT NOT NULL UNIQUE REFERENCES full_book_consents(id),
 native_consent_id TEXT NOT NULL REFERENCES full_book_managed_consents(id), job_id TEXT NOT NULL UNIQUE REFERENCES full_book_jobs(id),
 effective_ceiling INTEGER NOT NULL, record_json TEXT NOT NULL,
 CHECK(json_extract(record_json,'$.id')=id AND json_extract(record_json,'$.budgetConsentId')=consent_id AND json_extract(record_json,'$.nativeConsentId')=native_consent_id AND json_extract(record_json,'$.jobId')=job_id),
 CHECK(json_extract(record_json,'$.effectiveCeiling')=effective_ceiling AND json_extract(record_json,'$.extraHold')=1 AND json_extract(record_json,'$.ordinal')=3 AND json_extract(record_json,'$.stopAfterResult')=1)
);
--> statement-breakpoint
CREATE TABLE full_book_recovery_uses (
 amendment_id TEXT PRIMARY KEY NOT NULL REFERENCES full_book_recoveries(id),
 attempt_id TEXT NOT NULL UNIQUE REFERENCES external_attempts(id) DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE TRIGGER recovery_admission BEFORE INSERT ON full_book_recoveries
WHEN NOT EXISTS(SELECT 1 FROM full_book_active_consents c JOIN full_book_jobs j ON j.consent_id=c.id JOIN generation_runs r ON r.id=j.run_id
 JOIN full_book_managed_consents n ON n.budget_consent_id=c.id
 WHERE c.id=NEW.consent_id AND n.id=NEW.native_consent_id AND j.id=NEW.job_id AND j.node_index=0 AND j.state='paused' AND r.state='paused' AND r.reserved_calls=2
 AND NEW.effective_ceiling=c.ceiling+1 AND json_extract(NEW.record_json,'$.originalCeiling')=c.ceiling AND json_extract(NEW.record_json,'$.runId')=j.run_id
 AND (SELECT COUNT(*) FROM external_attempts a WHERE a.run_id=j.run_id)=2
 AND EXISTS(SELECT 1 FROM external_attempts a WHERE a.run_id=j.run_id AND a.reservation=1 AND a.state='outcome_unknown' AND a.id=json_extract(NEW.record_json,'$.priorAttemptIds[0]') AND json_extract(a.record_json,'$.resolution')='retry-approved')
 AND EXISTS(SELECT 1 FROM external_attempts a WHERE a.run_id=j.run_id AND a.reservation=2 AND a.state='outcome_unknown' AND a.id=json_extract(NEW.record_json,'$.priorAttemptIds[1]') AND json_extract(a.record_json,'$.resolution')='awaiting-owner')
 AND NOT EXISTS(SELECT 1 FROM full_book_output_receipts o WHERE o.consent_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM full_book_managed_revocations v WHERE v.consent_id=n.id))
BEGIN SELECT RAISE(ABORT,'exact exhausted first-map owner amendment required'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_no_update BEFORE UPDATE ON full_book_recoveries BEGIN SELECT RAISE(ABORT,'owner recovery amendment is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_no_delete BEFORE DELETE ON full_book_recoveries BEGIN SELECT RAISE(ABORT,'owner recovery amendment is retained'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_use_no_update BEFORE UPDATE ON full_book_recovery_uses BEGIN SELECT RAISE(ABORT,'recovery consumption is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_use_no_delete BEFORE DELETE ON full_book_recovery_uses BEGIN SELECT RAISE(ABORT,'recovery charge permission is retained'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_prior_unknown_state BEFORE UPDATE ON external_attempts
WHEN OLD.state='outcome_unknown' AND NEW.state!='outcome_unknown' AND EXISTS(SELECT 1 FROM full_book_recoveries x WHERE OLD.id IN (json_extract(x.record_json,'$.priorAttemptIds[0]'),json_extract(x.record_json,'$.priorAttemptIds[1]')))
BEGIN SELECT RAISE(ABORT,'covered unknown outcomes require separate reconciliation'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_use_admission BEFORE INSERT ON full_book_recovery_uses
WHEN NOT EXISTS(SELECT 1 FROM full_book_recoveries x JOIN full_book_jobs j ON j.id=x.job_id JOIN generation_runs r ON r.id=j.run_id JOIN full_book_active_consents c ON c.id=x.consent_id
 WHERE x.id=NEW.amendment_id AND j.state='running' AND r.reserved_calls=2 AND json_extract(r.record_json,'$.budget.maxCalls')=2
 AND NOT EXISTS(SELECT 1 FROM full_book_managed_revocations v WHERE v.consent_id=x.native_consent_id)
 AND c.setup_revision_id=(SELECT id FROM setup_revisions WHERE study_id=c.study_id ORDER BY rowid DESC LIMIT 1)
 AND COALESCE((SELECT revision FROM subscription_connections WHERE installation_id=json_extract(c.record_json,'$.session.destination.installationId') AND provider='chatgpt-subscription'),0)=json_extract(c.record_json,'$.session.destination.connectionRevision'))
BEGIN SELECT RAISE(ABORT,'pending fenced recovery permission required'); END;
--> statement-breakpoint
DROP TRIGGER full_book_attempt_admission;
--> statement-breakpoint
DROP TRIGGER full_book_output_admission;
--> statement-breakpoint
DROP TRIGGER full_book_dispatch_authority;
--> statement-breakpoint
DROP TRIGGER full_book_run_counter;
--> statement-breakpoint
CREATE TABLE full_book_wires_next (
 attempt_id TEXT PRIMARY KEY NOT NULL REFERENCES external_attempts(id) DEFERRABLE INITIALLY DEFERRED,
 job_id TEXT NOT NULL REFERENCES full_book_jobs(id), ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 3),
 record_json TEXT NOT NULL, UNIQUE(job_id,ordinal),
 CHECK(json_extract(record_json,'$.attemptId')=attempt_id), CHECK(json_extract(record_json,'$.jobId')=job_id),
 CHECK(json_extract(record_json,'$.ordinal')=ordinal), CHECK(json_extract(record_json,'$.transport')='synthetic-only-no-native-entry'),
 CHECK((ordinal<=2 AND json_type(record_json,'$.recoveryId') IS NULL) OR (ordinal=3 AND json_type(record_json,'$.recoveryId')='text'))
);
--> statement-breakpoint
INSERT INTO full_book_wires_next SELECT * FROM full_book_wires;
--> statement-breakpoint
DROP TABLE full_book_wires;
--> statement-breakpoint
ALTER TABLE full_book_wires_next RENAME TO full_book_wires;
--> statement-breakpoint
CREATE TRIGGER full_book_wire_no_update BEFORE UPDATE ON full_book_wires BEGIN SELECT RAISE(ABORT,'canonical experimental wire is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_wire_no_delete BEFORE DELETE ON full_book_wires BEGIN SELECT RAISE(ABORT,'canonical experimental wire is retained'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_wire_admission BEFORE INSERT ON full_book_wires
WHEN (NEW.ordinal=3 AND NOT EXISTS(SELECT 1 FROM full_book_recoveries x JOIN full_book_recovery_uses u ON u.amendment_id=x.id WHERE x.job_id=NEW.job_id AND u.attempt_id=NEW.attempt_id AND x.id=json_extract(NEW.record_json,'$.recoveryId')))
 OR EXISTS(SELECT 1 FROM full_book_recoveries x JOIN full_book_jobs j ON j.consent_id=x.consent_id WHERE j.id=NEW.job_id AND (NEW.ordinal!=3 OR x.job_id!=NEW.job_id))
BEGIN SELECT RAISE(ABORT,'only consumed exact recovery wire is admissible'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_attempt_admission BEFORE INSERT ON external_attempts
WHEN EXISTS(SELECT 1 FROM full_book_jobs j WHERE j.run_id=NEW.run_id) AND NOT EXISTS(
 SELECT 1 FROM full_book_jobs j JOIN full_book_active_consents c ON c.id=j.consent_id JOIN full_book_wires w ON w.job_id=j.id JOIN generation_runs r ON r.id=j.run_id
 WHERE j.run_id=NEW.run_id AND w.attempt_id=NEW.id AND w.ordinal=NEW.reservation AND NEW.state='prepared' AND j.state='running'
 AND json_extract(w.record_json,'$.targetHash')=j.target_hash AND json_extract(w.record_json,'$.leaseToken')=j.token AND json_extract(w.record_json,'$.leaseFence')=j.fence AND r.reserved_calls=NEW.reservation
 AND ((NEW.reservation BETWEEN 1 AND 2 AND NOT EXISTS(SELECT 1 FROM full_book_recoveries x WHERE x.consent_id=c.id)) OR
 (NEW.reservation=3 AND EXISTS(SELECT 1 FROM full_book_recoveries x JOIN full_book_recovery_uses u ON u.amendment_id=x.id WHERE x.job_id=j.id AND u.attempt_id=NEW.id))))
BEGIN SELECT RAISE(ABORT,'canonical charged experimental wire required'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_run_counter BEFORE UPDATE ON generation_runs
WHEN EXISTS(SELECT 1 FROM full_book_jobs j WHERE j.run_id=OLD.id) AND
 (NEW.id!=OLD.id OR NEW.input_revision_id!=OLD.input_revision_id OR NEW.reserved_calls<OLD.reserved_calls OR NEW.reserved_calls>OLD.reserved_calls+1
 OR NOT ((NEW.reserved_calls<=2 AND json_extract(NEW.record_json,'$.budget.maxCalls')=2) OR
 (NEW.reserved_calls=3 AND json_extract(NEW.record_json,'$.budget.maxCalls')=3 AND EXISTS(SELECT 1 FROM full_book_recoveries x JOIN full_book_jobs j ON j.id=x.job_id JOIN full_book_recovery_uses u ON u.amendment_id=x.id JOIN full_book_wires w ON w.attempt_id=u.attempt_id WHERE j.run_id=NEW.id AND w.ordinal=3)))
 OR (NEW.reserved_calls=OLD.reserved_calls+1 AND NOT EXISTS(SELECT 1 FROM full_book_wires w JOIN full_book_jobs j ON j.id=w.job_id WHERE j.run_id=OLD.id AND w.ordinal=NEW.reserved_calls)))
BEGIN SELECT RAISE(ABORT,'experimental run counter is finite and monotonic'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_dispatch_authority BEFORE UPDATE ON external_attempts
WHEN NEW.state='dispatching' AND EXISTS(SELECT 1 FROM full_book_jobs j WHERE j.run_id=NEW.run_id) AND NOT EXISTS(
 SELECT 1 FROM full_book_jobs j JOIN full_book_active_consents c ON c.id=j.consent_id JOIN full_book_wires w ON w.attempt_id=NEW.id
 WHERE j.run_id=NEW.run_id AND j.state='running' AND json_extract(w.record_json,'$.leaseToken')=j.token AND json_extract(w.record_json,'$.leaseFence')=j.fence AND json_extract(w.record_json,'$.targetHash')=j.target_hash
 AND c.setup_revision_id=(SELECT id FROM setup_revisions WHERE study_id=c.study_id ORDER BY rowid DESC LIMIT 1)
 AND COALESCE((SELECT revision FROM subscription_connections WHERE installation_id=json_extract(c.record_json,'$.session.destination.installationId') AND provider='chatgpt-subscription'),0)=json_extract(c.record_json,'$.session.destination.connectionRevision'))
BEGIN SELECT RAISE(ABORT,'current experimental dispatch authority required'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_output_admission BEFORE INSERT ON full_book_output_receipts
WHEN NOT EXISTS(SELECT 1 FROM full_book_jobs j JOIN full_book_active_consents c ON c.id=j.consent_id JOIN full_book_wires w ON w.job_id=j.id JOIN external_attempts a ON a.id=w.attempt_id
 JOIN full_book_reply_metadata m ON m.attempt_id=a.id WHERE j.id=NEW.job_id AND j.consent_id=NEW.consent_id AND j.node_index=NEW.node_index AND j.state='running'
 AND a.id=NEW.attempt_id AND a.state='response-received' AND json_extract(w.record_json,'$.targetHash')=j.target_hash AND json_extract(m.record_json,'$.terminal')='completed'
 AND ((json_extract(m.record_json,'$.transport')='synthetic-only-no-native-entry' AND json_extract(m.record_json,'$.wireHash')=json_extract(w.record_json,'$.hash')) OR
 (json_extract(m.record_json,'$.transport')='managed-experimental-app-bounded' AND EXISTS(SELECT 1 FROM full_book_managed_frames f JOIN full_book_managed_consents n ON n.id=f.consent_id
 WHERE f.attempt_id=a.id AND n.budget_consent_id=c.id AND json_extract(m.record_json,'$.wireHash')=json_extract(f.record_json,'$.turn.sha256') AND NOT EXISTS(SELECT 1 FROM full_book_managed_revocations v WHERE v.consent_id=n.id))))
 AND c.setup_revision_id=(SELECT id FROM setup_revisions WHERE study_id=c.study_id ORDER BY rowid DESC LIMIT 1)
 AND COALESCE((SELECT revision FROM subscription_connections WHERE installation_id=json_extract(c.record_json,'$.session.destination.installationId') AND provider='chatgpt-subscription'),0)=json_extract(c.record_json,'$.session.destination.connectionRevision'))
BEGIN SELECT RAISE(ABORT,'received canonical authorized output required'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_stop_claim BEFORE UPDATE ON full_book_jobs
WHEN NEW.state='running' AND (OLD.state!='running' OR NEW.fence!=OLD.fence) AND EXISTS(
 SELECT 1 FROM full_book_recoveries x WHERE x.consent_id=NEW.consent_id AND (x.job_id!=NEW.id OR EXISTS(SELECT 1 FROM full_book_recovery_uses u WHERE u.amendment_id=x.id)))
BEGIN SELECT RAISE(ABORT,'recovery stops after one charged first-map attempt'); END;
--> statement-breakpoint
DROP VIEW full_book_source_commitments;
--> statement-breakpoint
CREATE VIEW full_book_source_commitments AS
SELECT k.owner_id,k.source_hash,
 (SELECT COUNT(DISTINCT a.id) FROM external_attempts a JOIN live_study_scope_jobs j ON j.run_id=a.run_id WHERE j.owner_id=k.owner_id AND j.source_hash=k.source_hash)
 +(SELECT COUNT(a.id) FROM external_attempts a JOIN full_book_jobs j ON j.run_id=a.run_id JOIN full_book_consents c ON c.id=j.consent_id WHERE c.owner_id=k.owner_id AND c.source_hash=k.source_hash)
 +(SELECT COUNT(a.id) FROM full_book_imports i,json_each(i.record_json,'$.attemptIds') x JOIN external_attempts a ON a.id=x.value WHERE i.owner_id=k.owner_id AND i.source_hash=k.source_hash) AS spent,
 (SELECT COALESCE(SUM(c.held_calls+(SELECT COUNT(*) FROM full_book_recoveries x WHERE x.consent_id=c.id)
 -(SELECT COUNT(a.id) FROM external_attempts a JOIN full_book_jobs j ON j.run_id=a.run_id WHERE j.consent_id=c.id)
 -(SELECT COALESCE(SUM(n.released_calls),0) FROM full_book_not_needed n WHERE n.consent_id=c.id)),0) FROM full_book_active_consents c WHERE c.owner_id=k.owner_id AND c.source_hash=k.source_hash) AS held
FROM (SELECT owner_id,source_hash FROM full_book_consents UNION SELECT owner_id,source_hash FROM live_study_scope_jobs UNION SELECT owner_id,source_hash FROM full_book_imports) k;
