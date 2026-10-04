CREATE TABLE study_forks (
  study_id TEXT PRIMARY KEY REFERENCES studies(id),
  parent_study_id TEXT NOT NULL REFERENCES studies(id),
  parent_setup_revision_id TEXT NOT NULL REFERENCES setup_revisions(id),
  CHECK (study_id != parent_study_id)
);
--> statement-breakpoint
CREATE TRIGGER study_fork_lineage BEFORE INSERT ON study_forks
WHEN NOT EXISTS (
  SELECT 1 FROM studies child JOIN studies parent
  ON child.edition_id = parent.edition_id AND child.owner_id = parent.owner_id
  JOIN setup_revisions setup ON setup.study_id = parent.id
  WHERE child.id = NEW.study_id AND parent.id = NEW.parent_study_id
  AND setup.id = NEW.parent_setup_revision_id
)
BEGIN SELECT RAISE(ABORT, 'fork lineage mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER study_forks_no_update BEFORE UPDATE ON study_forks
BEGIN SELECT RAISE(ABORT, 'immutable fork lineage'); END;
--> statement-breakpoint
CREATE TRIGGER study_forks_no_delete BEFORE DELETE ON study_forks
BEGIN SELECT RAISE(ABORT, 'immutable fork lineage'); END;
