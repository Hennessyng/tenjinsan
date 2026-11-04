CREATE TABLE full_book_imports (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES owners(id), source_hash TEXT NOT NULL,
 study_id TEXT NOT NULL REFERENCES studies(id), setup_revision_id TEXT NOT NULL REFERENCES setup_revisions(id),
 consent_id TEXT NOT NULL UNIQUE, budget_version INTEGER NOT NULL CHECK(budget_version>0),
 spent INTEGER NOT NULL CHECK(spent>=0), held INTEGER NOT NULL CHECK(held=0), record_json TEXT NOT NULL,
 CHECK(json_extract(record_json,'$.authority')='historical-audit-only'),
 CHECK(json_extract(record_json,'$.id')=id AND json_extract(record_json,'$.auditBlobHash')=id),
 CHECK(json_extract(record_json,'$.sourceHash')=source_hash AND json_extract(record_json,'$.consentId')=consent_id),
 CHECK(json_extract(record_json,'$.studyId')=study_id AND json_extract(record_json,'$.setupRevisionId')=setup_revision_id),
 CHECK(json_extract(record_json,'$.budgetVersion')=budget_version AND json_extract(record_json,'$.spent')=spent),
 CHECK(json_extract(record_json,'$.held')=0 AND json_array_length(record_json,'$.attemptIds')=spent)
);
--> statement-breakpoint
CREATE TRIGGER full_book_import_no_update BEFORE UPDATE ON full_book_imports
BEGIN SELECT RAISE(ABORT,'historical experimental audit is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_import_no_delete BEFORE DELETE ON full_book_imports
BEGIN SELECT RAISE(ABORT,'historical experimental charges are retained'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_import_overlap BEFORE INSERT ON full_book_imports
WHEN EXISTS(SELECT 1 FROM full_book_imports i,json_each(i.record_json,'$.runIds') r,json_each(NEW.record_json,'$.runIds') n WHERE r.value=n.value)
 OR EXISTS(SELECT 1 FROM full_book_imports i,json_each(i.record_json,'$.attemptIds') r,json_each(NEW.record_json,'$.attemptIds') n WHERE r.value=n.value)
BEGIN SELECT RAISE(ABORT,'historical experimental identity counted twice'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_import_no_ordinary_job BEFORE INSERT ON jobs
WHEN EXISTS(SELECT 1 FROM full_book_imports i,json_each(i.record_json,'$.runIds') r WHERE r.value=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'historical experimental runs cannot acquire jobs'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_import_no_new_attempt BEFORE INSERT ON external_attempts
WHEN EXISTS(SELECT 1 FROM full_book_imports i,json_each(i.record_json,'$.runIds') r WHERE r.value=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'historical experimental runs cannot reserve attempts'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_import_frozen_attempt BEFORE UPDATE ON external_attempts
WHEN EXISTS(SELECT 1 FROM full_book_imports i,json_each(i.record_json,'$.attemptIds') a WHERE a.value=OLD.id)
BEGIN SELECT RAISE(ABORT,'historical experimental attempts are not capabilities'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_import_attempt_retained BEFORE DELETE ON external_attempts
WHEN EXISTS(SELECT 1 FROM full_book_imports i,json_each(i.record_json,'$.attemptIds') a WHERE a.value=OLD.id)
BEGIN SELECT RAISE(ABORT,'historical experimental charges cannot be refunded'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_import_frozen_run BEFORE UPDATE ON generation_runs
WHEN EXISTS(SELECT 1 FROM full_book_imports i,json_each(i.record_json,'$.runIds') r WHERE r.value=OLD.id)
BEGIN SELECT RAISE(ABORT,'historical experimental run is non-executable'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_import_consent_revoked BEFORE INSERT ON full_book_consents
WHEN EXISTS(SELECT 1 FROM full_book_imports i WHERE i.consent_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'historical consent requires a fresh identity and approval'); END;
--> statement-breakpoint
DROP VIEW full_book_source_commitments;
--> statement-breakpoint
CREATE VIEW full_book_source_commitments AS
SELECT k.owner_id,k.source_hash,
 (SELECT COUNT(DISTINCT a.id) FROM external_attempts a JOIN live_study_scope_jobs j ON j.run_id=a.run_id WHERE j.owner_id=k.owner_id AND j.source_hash=k.source_hash)
 +(SELECT COUNT(a.id) FROM external_attempts a JOIN full_book_jobs j ON j.run_id=a.run_id JOIN full_book_consents c ON c.id=j.consent_id WHERE c.owner_id=k.owner_id AND c.source_hash=k.source_hash)
 +(SELECT COUNT(a.id) FROM full_book_imports i,json_each(i.record_json,'$.attemptIds') x JOIN external_attempts a ON a.id=x.value WHERE i.owner_id=k.owner_id AND i.source_hash=k.source_hash) AS spent,
 (SELECT COALESCE(SUM(c.held_calls-(SELECT COUNT(a.id) FROM external_attempts a JOIN full_book_jobs j ON j.run_id=a.run_id WHERE j.consent_id=c.id)),0) FROM full_book_active_consents c WHERE c.owner_id=k.owner_id AND c.source_hash=k.source_hash) AS held
FROM (SELECT owner_id,source_hash FROM full_book_consents UNION SELECT owner_id,source_hash FROM live_study_scope_jobs UNION SELECT owner_id,source_hash FROM full_book_imports) k;
--> statement-breakpoint
DROP TRIGGER full_book_single_active;
--> statement-breakpoint
CREATE TRIGGER full_book_single_active BEFORE INSERT ON full_book_consents
WHEN EXISTS(SELECT 1 FROM full_book_active_consents c WHERE c.owner_id=NEW.owner_id AND c.source_hash=NEW.source_hash)
 OR NEW.budget_version!=(SELECT COALESCE(MAX(v),0)+1 FROM (
 SELECT budget_version AS v FROM full_book_consents WHERE owner_id=NEW.owner_id AND source_hash=NEW.source_hash
 UNION ALL SELECT budget_version AS v FROM full_book_imports WHERE owner_id=NEW.owner_id AND source_hash=NEW.source_hash))
BEGIN SELECT RAISE(ABORT,'one monotonic active source budget version required'); END;
--> statement-breakpoint
DROP TRIGGER full_book_legacy_twenty;
--> statement-breakpoint
CREATE TRIGGER full_book_legacy_twenty BEFORE INSERT ON external_attempts
WHEN EXISTS(SELECT 1 FROM live_study_scope_jobs j JOIN full_book_source_commitments u ON u.owner_id=j.owner_id AND u.source_hash=j.source_hash
 WHERE j.run_id=NEW.run_id AND u.spent>=20 AND (EXISTS(SELECT 1 FROM full_book_consents c WHERE c.owner_id=j.owner_id AND c.source_hash=j.source_hash)
 OR EXISTS(SELECT 1 FROM full_book_imports i WHERE i.owner_id=j.owner_id AND i.source_hash=j.source_hash)))
BEGIN SELECT RAISE(ABORT,'old grants retain the cumulative twenty-slot ceiling'); END;
