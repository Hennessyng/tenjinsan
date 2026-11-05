CREATE TABLE live_study_budgets (
 id TEXT PRIMARY KEY NOT NULL,
 owner_id TEXT NOT NULL REFERENCES owners(id),
 source_hash TEXT NOT NULL,
 total_limit INTEGER NOT NULL CHECK(total_limit=20),
 reserved_total INTEGER NOT NULL CHECK(reserved_total BETWEEN 0 AND 20),
 kind TEXT NOT NULL CHECK(kind IN ('live','restored')),
 adoption_json TEXT NOT NULL,
 UNIQUE(owner_id,source_hash)
);
--> statement-breakpoint
CREATE TABLE live_study_budget_members (
 authorization_id TEXT PRIMARY KEY NOT NULL REFERENCES live_study_guards(authorization_id),
 budget_id TEXT NOT NULL REFERENCES live_study_budgets(id)
);
--> statement-breakpoint
CREATE TABLE live_study_retirements (
 authorization_id TEXT PRIMARY KEY NOT NULL REFERENCES live_study_guards(authorization_id),
 budget_id TEXT NOT NULL REFERENCES live_study_budgets(id),
 reason TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE live_study_budget_approvals (
 authorization_id TEXT PRIMARY KEY NOT NULL,
 budget_id TEXT NOT NULL REFERENCES live_study_budgets(id),
 study_id TEXT NOT NULL UNIQUE REFERENCES studies(id),
 setup_revision_id TEXT NOT NULL UNIQUE REFERENCES setup_revisions(id),
 target_json TEXT NOT NULL,
 setup_hash TEXT NOT NULL,
 attempt_limit INTEGER NOT NULL CHECK(attempt_limit BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE TABLE live_study_adoption_barriers (
 authorization_id TEXT PRIMARY KEY NOT NULL REFERENCES live_study_guards(authorization_id),
 owner_id TEXT NOT NULL REFERENCES owners(id)
);
--> statement-breakpoint
INSERT INTO live_study_adoption_barriers
SELECT g.authorization_id,s.owner_id FROM live_study_guards g JOIN studies s ON s.id=g.study_id;
--> statement-breakpoint
CREATE TRIGGER shared_adoption_barrier_no_update BEFORE UPDATE ON live_study_adoption_barriers
BEGIN SELECT RAISE(ABORT,'migration adoption barrier is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER shared_adoption_barrier_no_delete BEFORE DELETE ON live_study_adoption_barriers
BEGIN SELECT RAISE(ABORT,'migration adoption barrier is immutable'); END;
--> statement-breakpoint
CREATE VIEW live_study_pending_adoption AS
SELECT DISTINCT b.owner_id FROM live_study_adoption_barriers b
WHERE NOT EXISTS(SELECT 1 FROM live_study_budget_members m WHERE m.authorization_id=b.authorization_id);
--> statement-breakpoint
CREATE TRIGGER shared_adoption_guard_insert BEFORE INSERT ON live_study_guards
WHEN EXISTS(SELECT 1 FROM studies s JOIN live_study_pending_adoption p ON p.owner_id=s.owner_id WHERE s.id=NEW.study_id)
BEGIN SELECT RAISE(ABORT,'shared adoption required before arming'); END;
--> statement-breakpoint
CREATE TRIGGER shared_budget_guard_enrollment BEFORE INSERT ON live_study_guards
WHEN EXISTS(SELECT 1 FROM studies s JOIN live_study_budgets b ON b.owner_id=s.owner_id WHERE s.id=NEW.study_id)
 AND NOT EXISTS(SELECT 1 FROM live_study_budget_approvals a JOIN live_study_budgets b ON b.id=a.budget_id
 JOIN studies s ON s.id=a.study_id WHERE a.authorization_id=NEW.authorization_id AND a.study_id=NEW.study_id
 AND a.setup_revision_id=NEW.setup_revision_id AND a.target_json=NEW.target_json AND a.setup_hash=NEW.setup_hash
 AND s.owner_id=b.owner_id AND b.kind='live' AND json_extract(NEW.target_json,'$.budgetId')=b.id
 AND json_extract(NEW.target_json,'$.attemptLimit')=a.attempt_limit AND a.attempt_limit<=b.total_limit-b.reserved_total)
BEGIN SELECT RAISE(ABORT,'shared budget approval required before arming'); END;
--> statement-breakpoint
CREATE TRIGGER shared_adoption_grant_insert BEFORE INSERT ON transmission_grants
WHEN NEW.kind='active' AND EXISTS(SELECT 1 FROM setup_revisions s JOIN studies st ON st.id=s.study_id JOIN live_study_pending_adoption p ON p.owner_id=st.owner_id WHERE s.id=NEW.setup_revision_id)
BEGIN SELECT RAISE(ABORT,'shared adoption required before consent'); END;
--> statement-breakpoint
CREATE TRIGGER shared_adoption_job_insert BEFORE INSERT ON jobs
WHEN EXISTS(SELECT 1 FROM setup_revisions s JOIN studies st ON st.id=s.study_id JOIN live_study_pending_adoption p ON p.owner_id=st.owner_id WHERE s.id=NEW.setup_revision_id)
BEGIN SELECT RAISE(ABORT,'shared adoption required before enqueue'); END;
--> statement-breakpoint
CREATE TRIGGER shared_adoption_job_claim BEFORE UPDATE ON jobs
WHEN NEW.state='running' AND EXISTS(SELECT 1 FROM setup_revisions s JOIN studies st ON st.id=s.study_id JOIN live_study_pending_adoption p ON p.owner_id=st.owner_id WHERE s.id=NEW.setup_revision_id)
BEGIN SELECT RAISE(ABORT,'shared adoption required before claim'); END;
--> statement-breakpoint
CREATE TRIGGER shared_adoption_attempt_insert BEFORE INSERT ON external_attempts
WHEN EXISTS(SELECT 1 FROM jobs j JOIN setup_revisions s ON s.id=j.setup_revision_id JOIN studies st ON st.id=s.study_id JOIN live_study_pending_adoption p ON p.owner_id=st.owner_id WHERE j.run_id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'shared adoption required before reservation'); END;
--> statement-breakpoint
CREATE TRIGGER shared_adoption_attempt_dispatch BEFORE UPDATE ON external_attempts
WHEN NEW.state='dispatching' AND EXISTS(SELECT 1 FROM jobs j JOIN setup_revisions s ON s.id=j.setup_revision_id JOIN studies st ON st.id=s.study_id JOIN live_study_pending_adoption p ON p.owner_id=st.owner_id WHERE j.run_id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'shared adoption required before dispatch'); END;
--> statement-breakpoint
CREATE TRIGGER shared_adoption_job_delete BEFORE DELETE ON jobs
WHEN EXISTS(SELECT 1 FROM setup_revisions s JOIN studies st ON st.id=s.study_id JOIN live_study_pending_adoption p ON p.owner_id=st.owner_id WHERE s.id=OLD.setup_revision_id)
BEGIN SELECT RAISE(ABORT,'shared adoption required before deleting history'); END;
--> statement-breakpoint
CREATE TRIGGER shared_adoption_attempt_delete BEFORE DELETE ON external_attempts
WHEN EXISTS(SELECT 1 FROM jobs j JOIN setup_revisions s ON s.id=j.setup_revision_id JOIN studies st ON st.id=s.study_id JOIN live_study_pending_adoption p ON p.owner_id=st.owner_id WHERE j.run_id=OLD.run_id)
BEGIN SELECT RAISE(ABORT,'shared adoption required before deleting reservations'); END;
--> statement-breakpoint
CREATE TRIGGER live_budget_immutable_update BEFORE UPDATE ON live_study_budgets
WHEN NEW.id != OLD.id OR NEW.owner_id != OLD.owner_id OR NEW.source_hash != OLD.source_hash
 OR NEW.total_limit != OLD.total_limit OR NEW.kind != OLD.kind OR NEW.adoption_json != OLD.adoption_json
 OR NEW.reserved_total != OLD.reserved_total+1
BEGIN SELECT RAISE(ABORT,'shared budget is monotonic'); END;
--> statement-breakpoint
CREATE TRIGGER live_budget_no_delete BEFORE DELETE ON live_study_budgets
BEGIN SELECT RAISE(ABORT,'shared budget is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER live_budget_member_no_update BEFORE UPDATE ON live_study_budget_members
BEGIN SELECT RAISE(ABORT,'budget membership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER live_budget_member_no_delete BEFORE DELETE ON live_study_budget_members
BEGIN SELECT RAISE(ABORT,'budget membership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER live_retirement_no_update BEFORE UPDATE ON live_study_retirements
BEGIN SELECT RAISE(ABORT,'target retirement is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER live_retirement_no_delete BEFORE DELETE ON live_study_retirements
BEGIN SELECT RAISE(ABORT,'target retirement is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER live_budget_approval_no_update BEFORE UPDATE ON live_study_budget_approvals
BEGIN SELECT RAISE(ABORT,'budget approval is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER live_budget_approval_no_delete BEFORE DELETE ON live_study_budget_approvals
BEGIN SELECT RAISE(ABORT,'budget approval is immutable'); END;
--> statement-breakpoint
CREATE VIEW live_study_scope_jobs AS
SELECT j.id AS job_id,j.run_id,j.setup_revision_id,j.state,st.owner_id,
 json_extract(s.record_json,'$.analysis.editionHash') AS source_hash
FROM jobs j JOIN setup_revisions s ON s.id=j.setup_revision_id JOIN studies st ON st.id=s.study_id;
--> statement-breakpoint
CREATE VIEW live_study_effective_admission AS
SELECT s.id AS setup_id,b.id AS budget_id,b.reserved_total,b.total_limit,b.kind,b.owner_id,b.source_hash,
 g.authorization_id,
 CASE WHEN r.authorization_id IS NOT NULL THEN 1 ELSE 0 END AS retired,
 CASE WHEN m.authorization_id IS NOT NULL THEN 1 ELSE 0 END AS enrolled,
 a.attempt_limit AS approved_limit
FROM setup_revisions s JOIN studies st ON st.id=s.study_id
JOIN live_study_budgets b ON b.owner_id=st.owner_id AND b.source_hash=json_extract(s.record_json,'$.analysis.editionHash')
LEFT JOIN live_study_guards g ON g.setup_revision_id=s.id
LEFT JOIN live_study_budget_members m ON m.authorization_id=g.authorization_id AND m.budget_id=b.id
LEFT JOIN live_study_retirements r ON r.authorization_id=g.authorization_id
LEFT JOIN live_study_budget_approvals a ON a.authorization_id=g.authorization_id AND a.budget_id=b.id;
--> statement-breakpoint
CREATE TRIGGER shared_budget_attempt_admission BEFORE INSERT ON external_attempts
WHEN EXISTS(SELECT 1 FROM jobs j JOIN live_study_effective_admission e ON e.setup_id=j.setup_revision_id
 WHERE j.run_id=NEW.run_id AND (e.kind!='live' OR e.retired=1 OR e.enrolled=0 OR e.approved_limit IS NULL
 OR e.reserved_total>=e.total_limit
 OR e.reserved_total!=(SELECT COUNT(DISTINCT a.id) FROM external_attempts a JOIN live_study_scope_jobs k ON k.run_id=a.run_id WHERE k.owner_id=e.owner_id AND k.source_hash=e.source_hash)
 OR (SELECT COUNT(*) FROM external_attempts x JOIN jobs y ON y.run_id=x.run_id WHERE y.setup_revision_id=e.setup_id)>=e.approved_limit))
BEGIN SELECT RAISE(ABORT,'shared budget admission denied'); END;
--> statement-breakpoint
CREATE TRIGGER shared_budget_attempt_count AFTER INSERT ON external_attempts
WHEN EXISTS(SELECT 1 FROM jobs j JOIN live_study_effective_admission e ON e.setup_id=j.setup_revision_id WHERE j.run_id=NEW.run_id)
BEGIN
 UPDATE live_study_budgets SET reserved_total=reserved_total+1 WHERE id IN
 (SELECT e.budget_id FROM jobs j JOIN live_study_effective_admission e ON e.setup_id=j.setup_revision_id WHERE j.run_id=NEW.run_id)
 AND kind='live' AND reserved_total<total_limit;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'shared budget counter unavailable') END;
END;
--> statement-breakpoint
CREATE TRIGGER shared_budget_no_attempt_delete BEFORE DELETE ON external_attempts
WHEN EXISTS(SELECT 1 FROM jobs j JOIN live_study_effective_admission e ON e.setup_id=j.setup_revision_id WHERE j.run_id=OLD.run_id)
BEGIN SELECT RAISE(ABORT,'shared reservations cannot be refunded'); END;
--> statement-breakpoint
CREATE TRIGGER shared_budget_attempt_dispatch BEFORE UPDATE ON external_attempts
WHEN NEW.state='dispatching' AND EXISTS(SELECT 1 FROM jobs j JOIN live_study_effective_admission e ON e.setup_id=j.setup_revision_id
 WHERE j.run_id=NEW.run_id AND (e.kind!='live' OR e.retired=1 OR e.enrolled=0 OR e.approved_limit IS NULL))
BEGIN SELECT RAISE(ABORT,'retired or unavailable target dispatch'); END;
--> statement-breakpoint
CREATE TRIGGER shared_budget_job_insert BEFORE INSERT ON jobs
WHEN EXISTS(SELECT 1 FROM live_study_effective_admission e WHERE e.setup_id=NEW.setup_revision_id
 AND (e.kind!='live' OR e.retired=1 OR e.enrolled=0 OR e.approved_limit IS NULL))
BEGIN SELECT RAISE(ABORT,'retired or unavailable target job'); END;
--> statement-breakpoint
CREATE TRIGGER shared_budget_job_claim BEFORE UPDATE ON jobs
WHEN NEW.state='running' AND EXISTS(SELECT 1 FROM live_study_effective_admission e WHERE e.setup_id=NEW.setup_revision_id
 AND (e.kind!='live' OR e.retired=1 OR e.enrolled=0 OR e.approved_limit IS NULL))
BEGIN SELECT RAISE(ABORT,'retired or unavailable target claim'); END;
--> statement-breakpoint
CREATE TRIGGER shared_budget_job_no_delete BEFORE DELETE ON jobs
WHEN EXISTS(SELECT 1 FROM live_study_effective_admission e WHERE e.setup_id=OLD.setup_revision_id)
BEGIN SELECT RAISE(ABORT,'shared budget execution history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER shared_budget_grant_insert BEFORE INSERT ON transmission_grants
WHEN NEW.kind='active' AND EXISTS(SELECT 1 FROM live_study_effective_admission e WHERE e.setup_id=NEW.setup_revision_id
 AND (e.kind!='live' OR e.retired=1 OR e.enrolled=0 OR e.approved_limit IS NULL))
BEGIN SELECT RAISE(ABORT,'retired or unavailable target consent'); END;
