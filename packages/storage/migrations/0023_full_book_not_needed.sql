CREATE TABLE full_book_not_needed (
 consent_id TEXT NOT NULL REFERENCES full_book_consents(id), node_index INTEGER NOT NULL,
 job_id TEXT NOT NULL UNIQUE REFERENCES full_book_jobs(id), root_hash TEXT NOT NULL,
 released_calls INTEGER NOT NULL CHECK(released_calls=2), record_json TEXT NOT NULL,
 PRIMARY KEY(consent_id,node_index), CHECK(json_extract(json_extract(record_json,'$.serialized'),'$.rootHash') IS root_hash),
 CHECK(json_type(record_json,'$.outputHash') IS 'text' AND length(json_extract(record_json,'$.outputHash'))=64),
 CHECK(json_extract(json_extract(record_json,'$.serialized'),'$.kind') IS 'not-needed'), CHECK(json_extract(json_extract(record_json,'$.serialized'),'$.policyVersion') IS 'direct-children-2')
);
--> statement-breakpoint
CREATE TRIGGER full_book_not_needed_admission BEFORE INSERT ON full_book_not_needed
WHEN NOT EXISTS (
 SELECT 1 FROM full_book_jobs j JOIN full_book_active_consents c ON c.id=j.consent_id
 JOIN generation_runs r ON r.id=j.run_id
 JOIN full_book_output_receipts o ON o.consent_id=c.id
 JOIN full_book_jobs root_job ON root_job.id=o.job_id AND root_job.state='completed'
 JOIN external_attempts root_attempt ON root_attempt.id=o.attempt_id AND root_attempt.state='response-received'
 WHERE j.id=NEW.job_id AND j.node_index=NEW.node_index AND j.consent_id=NEW.consent_id
 AND j.state='queued' AND r.reserved_calls=0
 AND NOT EXISTS(SELECT 1 FROM external_attempts a WHERE a.run_id=j.run_id)
 AND json_extract(c.record_json,'$.session.input.hierarchyPolicy')='direct-children-2'
 AND json_extract(c.record_json,'$.session.plan.nodes['||o.node_index||'].id')=json_extract(c.record_json,'$.session.plan.root')
 AND json_extract(o.record_json,'$.outputHash')=NEW.root_hash
 AND json_extract(o.record_json,'$.outputHash')=json_extract(root_attempt.record_json,'$.responseHash')
 AND json_extract(o.record_json,'$.serialized')=CAST(root_attempt.response_body AS TEXT)
 AND json_extract(json_extract(NEW.record_json,'$.serialized'),'$.rootNodeId')=json_extract(c.record_json,'$.session.plan.root')
 AND json_extract(json_extract(o.record_json,'$.serialized'),'$.kind')='analysis'
 AND json_array_length(json_extract(o.record_json,'$.serialized'),'$.findings')>0
 AND json_extract(json_extract(NEW.record_json,'$.serialized'),'$.findingCount')=json_array_length(json_extract(o.record_json,'$.serialized'),'$.findings')
 AND json_extract(c.record_json,'$.session.plan.nodes['||j.node_index||'].kind') IN ('final-check','citation-check')
 AND json_extract(json_extract(NEW.record_json,'$.serialized'),'$.batch')=json_extract(c.record_json,'$.session.plan.nodes['||j.node_index||'].batch')
 AND json_extract(json_extract(NEW.record_json,'$.serialized'),'$.batch')*json_extract(c.record_json,'$.session.input.policy.findingsPerBatch')>=json_extract(json_extract(NEW.record_json,'$.serialized'),'$.findingCount')
)
BEGIN SELECT RAISE(ABORT,'accepted exact root and unissued unused batch required'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_not_needed_no_update BEFORE UPDATE ON full_book_not_needed
BEGIN SELECT RAISE(ABORT,'unused batch evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_not_needed_no_delete BEFORE DELETE ON full_book_not_needed
BEGIN SELECT RAISE(ABORT,'unused batch release evidence is retained'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_not_needed_attempt BEFORE INSERT ON external_attempts
WHEN EXISTS(SELECT 1 FROM full_book_not_needed n JOIN full_book_jobs j ON j.id=n.job_id WHERE j.run_id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'vacated batch cannot issue an attempt'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_not_needed_job BEFORE UPDATE ON full_book_jobs
WHEN EXISTS(SELECT 1 FROM full_book_not_needed n WHERE n.job_id=NEW.id AND
 (NEW.state!='completed' OR NEW.target_hash IS NOT json_extract(json_extract(n.record_json,'$.serialized'),'$.targetHash') OR NEW.token IS NOT NULL OR NEW.expires_at IS NOT NULL OR NEW.fence!=0))
BEGIN SELECT RAISE(ABORT,'vacated batch cannot regain execution authority'); END;
--> statement-breakpoint
CREATE TRIGGER full_book_not_needed_run BEFORE UPDATE ON generation_runs
WHEN EXISTS(SELECT 1 FROM full_book_not_needed n JOIN full_book_jobs j ON j.id=n.job_id WHERE j.run_id=NEW.id)
 AND (NEW.state!='completed' OR NEW.reserved_calls!=0)
BEGIN SELECT RAISE(ABORT,'vacated run remains unissued'); END;
--> statement-breakpoint
DROP TRIGGER full_book_claim_order;
--> statement-breakpoint
CREATE TRIGGER full_book_claim_order BEFORE UPDATE ON full_book_jobs
WHEN NEW.state='running' AND OLD.state!='running' AND
 (NEW.node_index!=(SELECT MIN(node_index) FROM full_book_jobs WHERE consent_id=NEW.consent_id AND state!='completed')
 OR NEW.fence!=OLD.fence+1 OR NEW.token IS NULL OR NEW.expires_at IS NULL)
BEGIN SELECT RAISE(ABORT,'only the next canonical fenced experimental job is claimable'); END;
--> statement-breakpoint
DROP VIEW full_book_source_commitments;
--> statement-breakpoint
CREATE VIEW full_book_source_commitments AS
SELECT k.owner_id,k.source_hash,
 (SELECT COUNT(DISTINCT a.id) FROM external_attempts a JOIN live_study_scope_jobs j ON j.run_id=a.run_id WHERE j.owner_id=k.owner_id AND j.source_hash=k.source_hash)
 +(SELECT COUNT(a.id) FROM external_attempts a JOIN full_book_jobs j ON j.run_id=a.run_id JOIN full_book_consents c ON c.id=j.consent_id WHERE c.owner_id=k.owner_id AND c.source_hash=k.source_hash)
 +(SELECT COUNT(a.id) FROM full_book_imports i,json_each(i.record_json,'$.attemptIds') x JOIN external_attempts a ON a.id=x.value WHERE i.owner_id=k.owner_id AND i.source_hash=k.source_hash) AS spent,
 (SELECT COALESCE(SUM(c.held_calls-(SELECT COUNT(a.id) FROM external_attempts a JOIN full_book_jobs j ON j.run_id=a.run_id WHERE j.consent_id=c.id)
 -(SELECT COALESCE(SUM(n.released_calls),0) FROM full_book_not_needed n WHERE n.consent_id=c.id)),0) FROM full_book_active_consents c WHERE c.owner_id=k.owner_id AND c.source_hash=k.source_hash) AS held
FROM (SELECT owner_id,source_hash FROM full_book_consents UNION SELECT owner_id,source_hash FROM live_study_scope_jobs UNION SELECT owner_id,source_hash FROM full_book_imports) k;
