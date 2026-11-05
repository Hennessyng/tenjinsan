CREATE TABLE full_book_consents (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id),
 study_id TEXT NOT NULL REFERENCES studies(id),
 setup_revision_id TEXT NOT NULL REFERENCES setup_revisions(id),
 source_hash TEXT NOT NULL,
 budget_version INTEGER NOT NULL CHECK(budget_version>0),
 ceiling INTEGER NOT NULL CHECK(ceiling>0),
 held_calls INTEGER NOT NULL CHECK(held_calls>0),
 setup_hash TEXT NOT NULL,
 record_json TEXT NOT NULL,
 UNIQUE(owner_id,source_hash,budget_version),
 CHECK(json_extract(record_json,'$.transport')='synthetic-only-no-native-entry'),
 CHECK(json_extract(record_json,'$.id')=id),
 CHECK(json_extract(record_json,'$.ownerId')=owner_id),
 CHECK(json_extract(record_json,'$.studyId')=study_id),
 CHECK(json_extract(record_json,'$.setupRevisionId')=setup_revision_id),
 CHECK(json_extract(record_json,'$.session.input.normalization.editionHash')=source_hash),
 CHECK(json_extract(record_json,'$.sourceCeiling')=ceiling),
 CHECK(json_extract(record_json,'$.session.plan.maxAttempts')=held_calls)
);
--> statement-breakpoint
CREATE TABLE full_book_consent_closures (
 consent_id TEXT PRIMARY KEY NOT NULL REFERENCES full_book_consents(id),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0)
);
--> statement-breakpoint
CREATE VIEW full_book_active_consents AS
SELECT c.* FROM full_book_consents c WHERE NOT EXISTS
 (SELECT 1 FROM full_book_consent_closures x WHERE x.consent_id=c.id);
--> statement-breakpoint
CREATE VIEW full_book_source_commitments AS
SELECT k.owner_id,k.source_hash,
 (SELECT COUNT(DISTINCT a.id) FROM external_attempts a JOIN live_study_scope_jobs j ON j.run_id=a.run_id
   WHERE j.owner_id=k.owner_id AND j.source_hash=k.source_hash) AS spent,
 (SELECT COALESCE(SUM(c.held_calls),0) FROM full_book_active_consents c
   WHERE c.owner_id=k.owner_id AND c.source_hash=k.source_hash) AS held
FROM (SELECT owner_id,source_hash FROM full_book_consents UNION SELECT owner_id,source_hash FROM live_study_scope_jobs) k;
--> statement-breakpoint
CREATE TRIGGER full_book_single_active BEFORE INSERT ON full_book_consents
WHEN EXISTS(SELECT 1 FROM full_book_active_consents c WHERE c.owner_id=NEW.owner_id AND c.source_hash=NEW.source_hash)
 OR NEW.budget_version!=(SELECT COALESCE(MAX(c.budget_version),0)+1 FROM full_book_consents c WHERE c.owner_id=NEW.owner_id AND c.source_hash=NEW.source_hash)
BEGIN SELECT RAISE(ABORT,'one active source budget version required'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_finite_admission BEFORE INSERT ON full_book_consents
WHEN NEW.held_calls>NEW.ceiling OR EXISTS(SELECT 1 FROM full_book_source_commitments u
 WHERE u.owner_id=NEW.owner_id AND u.source_hash=NEW.source_hash AND u.spent+u.held+NEW.held_calls>NEW.ceiling)
BEGIN SELECT RAISE(ABORT,'source commitment exceeds separately approved ceiling'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_consent_no_update BEFORE UPDATE ON full_book_consents
BEGIN SELECT RAISE(ABORT,'experimental consent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_consent_no_delete BEFORE DELETE ON full_book_consents
BEGIN SELECT RAISE(ABORT,'experimental consent history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_closure_no_update BEFORE UPDATE ON full_book_consent_closures
BEGIN SELECT RAISE(ABORT,'experimental closure is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_closure_no_delete BEFORE DELETE ON full_book_consent_closures
BEGIN SELECT RAISE(ABORT,'experimental closure history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_exclusive_legacy_attempt BEFORE INSERT ON external_attempts
WHEN EXISTS(SELECT 1 FROM live_study_scope_jobs j JOIN full_book_active_consents c
 ON c.owner_id=j.owner_id AND c.source_hash=j.source_hash WHERE j.run_id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'experimental source reservation is exclusive'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_exclusive_legacy_dispatch BEFORE UPDATE ON external_attempts
WHEN NEW.state='dispatching' AND EXISTS(SELECT 1 FROM live_study_scope_jobs j JOIN full_book_active_consents c
 ON c.owner_id=j.owner_id AND c.source_hash=j.source_hash WHERE j.run_id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'experimental source reservation is exclusive'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_exclusive_legacy_claim BEFORE UPDATE ON jobs
WHEN NEW.state='running' AND EXISTS(SELECT 1 FROM live_study_scope_jobs j JOIN full_book_active_consents c
 ON c.owner_id=j.owner_id AND c.source_hash=j.source_hash WHERE j.job_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'experimental source reservation is exclusive'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_exclusive_legacy_enqueue BEFORE INSERT ON jobs
WHEN EXISTS(SELECT 1 FROM setup_revisions s JOIN studies st ON st.id=s.study_id JOIN full_book_active_consents c
 ON c.owner_id=st.owner_id AND c.source_hash=json_extract(s.record_json,'$.analysis.editionHash') WHERE s.id=NEW.setup_revision_id)
BEGIN SELECT RAISE(ABORT,'experimental source reservation is exclusive'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_exclusive_legacy_grant BEFORE INSERT ON transmission_grants
WHEN NEW.kind='active' AND EXISTS(SELECT 1 FROM setup_revisions s JOIN studies st ON st.id=s.study_id JOIN full_book_active_consents c
 ON c.owner_id=st.owner_id AND c.source_hash=json_extract(s.record_json,'$.analysis.editionHash') WHERE s.id=NEW.setup_revision_id)
BEGIN SELECT RAISE(ABORT,'experimental source reservation is exclusive'); END;
