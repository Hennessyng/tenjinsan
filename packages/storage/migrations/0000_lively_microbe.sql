CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_revision_id` text NOT NULL,
	`job_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`publication_revision_id`) REFERENCES `publication_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `external_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`input_revision_id` text NOT NULL,
	`state` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`run_id`,`input_revision_id`) REFERENCES `generation_runs`(`id`,`input_revision_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `generation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`input_revision_id` text NOT NULL,
	`state` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`input_revision_id`) REFERENCES `input_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_id_input_unique` ON `generation_runs` (`id`,`input_revision_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`input_revision_id` text NOT NULL,
	`setup_revision_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`state` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`run_id`,`input_revision_id`) REFERENCES `generation_runs`(`id`,`input_revision_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`grant_id`,`setup_revision_id`) REFERENCES `transmission_grants`(`id`,`setup_revision_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`setup_revision_id`) REFERENCES `setup_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `book_editions` (
	`id` text PRIMARY KEY NOT NULL,
	`original_hash` text NOT NULL,
	`original_blob_hash` text NOT NULL,
	`title` text NOT NULL,
	`record_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `installations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installations_id_owner_unique` ON `installations` (`id`,`owner_id`);--> statement-breakpoint
CREATE TABLE `normalization_resources` (
	`normalization_revision_id` text NOT NULL,
	`edition_id` text NOT NULL,
	`resource_path` text NOT NULL,
	`position` integer NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	PRIMARY KEY(`normalization_revision_id`, `resource_path`),
	FOREIGN KEY (`normalization_revision_id`,`edition_id`) REFERENCES `normalization_revisions`(`id`,`edition_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `normalization_resource_edition_unique` ON `normalization_resources` (`normalization_revision_id`,`edition_id`,`resource_path`);--> statement-breakpoint
CREATE TABLE `normalization_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`edition_id` text NOT NULL,
	`parent_revision_id` text,
	`edition_hash` text NOT NULL,
	`parser_version` text NOT NULL,
	`normalizer_version` text NOT NULL,
	`coverage` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`edition_id`) REFERENCES `book_editions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_revision_id`,`edition_id`) REFERENCES `normalization_revisions`(`id`,`edition_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `normalization_id_edition_unique` ON `normalization_revisions` (`id`,`edition_id`);--> statement-breakpoint
CREATE TABLE `owners` (
	`id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setup_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`study_id` text NOT NULL,
	`edition_id` text NOT NULL,
	`normalization_revision_id` text NOT NULL,
	`parent_revision_id` text,
	`record_json` text NOT NULL,
	FOREIGN KEY (`study_id`,`edition_id`) REFERENCES `studies`(`id`,`edition_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`normalization_revision_id`,`edition_id`) REFERENCES `normalization_revisions`(`id`,`edition_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_revision_id`,`study_id`) REFERENCES `setup_revisions`(`id`,`study_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `setup_id_study_unique` ON `setup_revisions` (`id`,`study_id`);--> statement-breakpoint
CREATE TABLE `source_blocks` (
	`normalization_revision_id` text NOT NULL,
	`edition_id` text NOT NULL,
	`resource_path` text NOT NULL,
	`block_id` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	`original_fragment` text,
	`page_label` text,
	PRIMARY KEY(`normalization_revision_id`, `block_id`),
	FOREIGN KEY (`normalization_revision_id`,`edition_id`,`resource_path`) REFERENCES `normalization_resources`(`normalization_revision_id`,`edition_id`,`resource_path`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `studies` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`edition_id` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`edition_id`) REFERENCES `book_editions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studies_id_edition_unique` ON `studies` (`id`,`edition_id`);--> statement-breakpoint
CREATE TABLE `transmission_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`setup_revision_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`setup_revision_id`) REFERENCES `setup_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`installation_id`,`owner_id`) REFERENCES `installations`(`id`,`owner_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grant_id_setup_unique` ON `transmission_grants` (`id`,`setup_revision_id`);--> statement-breakpoint
CREATE TABLE `analysis_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`edition_id` text NOT NULL,
	`normalization_revision_id` text NOT NULL,
	`parent_revision_id` text,
	`cache_key` text NOT NULL,
	`status` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`normalization_revision_id`,`edition_id`) REFERENCES `normalization_revisions`(`id`,`edition_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_revision_id`,`edition_id`) REFERENCES `analysis_revisions`(`id`,`edition_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_id_edition_unique` ON `analysis_revisions` (`id`,`edition_id`);--> statement-breakpoint
CREATE TABLE `answer_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`question_revision_id` text NOT NULL,
	`question_id` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `input_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_revision_id`,`question_id`) REFERENCES `question_revisions`(`revision_id`,`question_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `brief_approvals` (
	`brief_revision_id` text PRIMARY KEY NOT NULL,
	`approved_at` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`brief_revision_id`) REFERENCES `brief_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `brief_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`study_id` text NOT NULL,
	`setup_revision_id` text NOT NULL,
	`analysis_revision_id` text NOT NULL,
	`parent_revision_id` text,
	`record_json` text NOT NULL,
	FOREIGN KEY (`study_id`) REFERENCES `studies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`setup_revision_id`) REFERENCES `setup_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`analysis_revision_id`) REFERENCES `analysis_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_revision_id`,`study_id`) REFERENCES `brief_revisions`(`id`,`study_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brief_id_study_unique` ON `brief_revisions` (`id`,`study_id`);--> statement-breakpoint
CREATE TABLE `evidence_reports` (
	`hash` text PRIMARY KEY NOT NULL,
	`lesson_revision_id` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`lesson_revision_id`) REFERENCES `lesson_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `input_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`study_id` text NOT NULL,
	`parent_revision_id` text,
	`kind` text NOT NULL,
	FOREIGN KEY (`study_id`) REFERENCES `studies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_revision_id`,`study_id`) REFERENCES `input_revisions`(`id`,`study_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `input_id_study_unique` ON `input_revisions` (`id`,`study_id`);--> statement-breakpoint
CREATE TABLE `lesson_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`study_id` text NOT NULL,
	`setup_revision_id` text NOT NULL,
	`analysis_revision_id` text NOT NULL,
	`brief_revision_id` text NOT NULL,
	`outline_revision_id` text NOT NULL,
	`parent_revision_id` text,
	`record_json` text NOT NULL,
	FOREIGN KEY (`study_id`) REFERENCES `studies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`setup_revision_id`) REFERENCES `setup_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`analysis_revision_id`) REFERENCES `analysis_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`brief_revision_id`) REFERENCES `brief_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`outline_revision_id`) REFERENCES `outline_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_revision_id`,`study_id`) REFERENCES `lesson_revisions`(`id`,`study_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_id_study_unique` ON `lesson_revisions` (`id`,`study_id`);--> statement-breakpoint
CREATE TABLE `outline_approvals` (
	`outline_revision_id` text PRIMARY KEY NOT NULL,
	`approved_at` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`outline_revision_id`) REFERENCES `outline_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `outline_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`study_id` text NOT NULL,
	`setup_revision_id` text NOT NULL,
	`analysis_revision_id` text NOT NULL,
	`brief_revision_id` text NOT NULL,
	`parent_revision_id` text,
	`record_json` text NOT NULL,
	FOREIGN KEY (`study_id`) REFERENCES `studies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`setup_revision_id`) REFERENCES `setup_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`analysis_revision_id`) REFERENCES `analysis_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`brief_revision_id`) REFERENCES `brief_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_revision_id`,`study_id`) REFERENCES `outline_revisions`(`id`,`study_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outline_id_study_unique` ON `outline_revisions` (`id`,`study_id`);--> statement-breakpoint
CREATE TABLE `privacy_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`projection_hash` text NOT NULL,
	`parent_revision_id` text,
	`status` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`parent_revision_id`) REFERENCES `privacy_reviews`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `publication_approvals` (
	`publication_revision_id` text PRIMARY KEY NOT NULL,
	`privacy_review_id` text NOT NULL,
	`projection_hash` text NOT NULL,
	`approved_at` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`publication_revision_id`) REFERENCES `publication_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`privacy_review_id`) REFERENCES `privacy_reviews`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `publication_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_revision_id` text NOT NULL,
	`analysis_revision_id` text NOT NULL,
	`privacy_review_id` text NOT NULL,
	`parent_revision_id` text,
	`projection_hash` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`lesson_revision_id`) REFERENCES `lesson_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`analysis_revision_id`) REFERENCES `analysis_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`privacy_review_id`) REFERENCES `privacy_reviews`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_revision_id`) REFERENCES `publication_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `question_revisions` (
	`revision_id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`analysis_revision_id` text NOT NULL,
	`parent_revision_id` text,
	`record_json` text NOT NULL,
	FOREIGN KEY (`analysis_revision_id`) REFERENCES `analysis_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_revision_id`,`question_id`) REFERENCES `question_revisions`(`revision_id`,`question_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_revision_question_unique` ON `question_revisions` (`revision_id`,`question_id`);
--> statement-breakpoint
CREATE TRIGGER `book_editions_no_update` BEFORE UPDATE ON `book_editions` BEGIN SELECT RAISE(ABORT, 'book_editions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `book_editions_no_delete` BEFORE DELETE ON `book_editions` BEGIN SELECT RAISE(ABORT, 'book_editions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `normalization_revisions_no_update` BEFORE UPDATE ON `normalization_revisions` BEGIN SELECT RAISE(ABORT, 'normalization_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `normalization_revisions_no_delete` BEFORE DELETE ON `normalization_revisions` BEGIN SELECT RAISE(ABORT, 'normalization_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `normalization_resources_no_update` BEFORE UPDATE ON `normalization_resources` BEGIN SELECT RAISE(ABORT, 'normalization_resources are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `normalization_resources_no_delete` BEFORE DELETE ON `normalization_resources` BEGIN SELECT RAISE(ABORT, 'normalization_resources are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `source_blocks_no_update` BEFORE UPDATE ON `source_blocks` BEGIN SELECT RAISE(ABORT, 'source_blocks are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `source_blocks_no_delete` BEFORE DELETE ON `source_blocks` BEGIN SELECT RAISE(ABORT, 'source_blocks are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `setup_revisions_no_update` BEFORE UPDATE ON `setup_revisions` BEGIN SELECT RAISE(ABORT, 'setup_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `setup_revisions_no_delete` BEFORE DELETE ON `setup_revisions` BEGIN SELECT RAISE(ABORT, 'setup_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `transmission_grants_no_update` BEFORE UPDATE ON `transmission_grants` BEGIN SELECT RAISE(ABORT, 'transmission_grants are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `transmission_grants_no_delete` BEFORE DELETE ON `transmission_grants` BEGIN SELECT RAISE(ABORT, 'transmission_grants are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `analysis_revisions_no_update` BEFORE UPDATE ON `analysis_revisions` BEGIN SELECT RAISE(ABORT, 'analysis_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `analysis_revisions_no_delete` BEFORE DELETE ON `analysis_revisions` BEGIN SELECT RAISE(ABORT, 'analysis_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `question_revisions_no_update` BEFORE UPDATE ON `question_revisions` BEGIN SELECT RAISE(ABORT, 'question_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `question_revisions_no_delete` BEFORE DELETE ON `question_revisions` BEGIN SELECT RAISE(ABORT, 'question_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `input_revisions_no_update` BEFORE UPDATE ON `input_revisions` BEGIN SELECT RAISE(ABORT, 'input_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `input_revisions_no_delete` BEFORE DELETE ON `input_revisions` BEGIN SELECT RAISE(ABORT, 'input_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `answer_revisions_no_update` BEFORE UPDATE ON `answer_revisions` BEGIN SELECT RAISE(ABORT, 'answer_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `answer_revisions_no_delete` BEFORE DELETE ON `answer_revisions` BEGIN SELECT RAISE(ABORT, 'answer_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `brief_revisions_no_update` BEFORE UPDATE ON `brief_revisions` BEGIN SELECT RAISE(ABORT, 'brief_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `brief_revisions_no_delete` BEFORE DELETE ON `brief_revisions` BEGIN SELECT RAISE(ABORT, 'brief_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `brief_approvals_no_update` BEFORE UPDATE ON `brief_approvals` BEGIN SELECT RAISE(ABORT, 'brief_approvals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `brief_approvals_no_delete` BEFORE DELETE ON `brief_approvals` BEGIN SELECT RAISE(ABORT, 'brief_approvals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `outline_revisions_no_update` BEFORE UPDATE ON `outline_revisions` BEGIN SELECT RAISE(ABORT, 'outline_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `outline_revisions_no_delete` BEFORE DELETE ON `outline_revisions` BEGIN SELECT RAISE(ABORT, 'outline_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `outline_approvals_no_update` BEFORE UPDATE ON `outline_approvals` BEGIN SELECT RAISE(ABORT, 'outline_approvals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `outline_approvals_no_delete` BEFORE DELETE ON `outline_approvals` BEGIN SELECT RAISE(ABORT, 'outline_approvals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `lesson_revisions_no_update` BEFORE UPDATE ON `lesson_revisions` BEGIN SELECT RAISE(ABORT, 'lesson_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `lesson_revisions_no_delete` BEFORE DELETE ON `lesson_revisions` BEGIN SELECT RAISE(ABORT, 'lesson_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `evidence_reports_no_update` BEFORE UPDATE ON `evidence_reports` BEGIN SELECT RAISE(ABORT, 'evidence_reports are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `evidence_reports_no_delete` BEFORE DELETE ON `evidence_reports` BEGIN SELECT RAISE(ABORT, 'evidence_reports are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `privacy_reviews_no_update` BEFORE UPDATE ON `privacy_reviews` BEGIN SELECT RAISE(ABORT, 'privacy_reviews are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `privacy_reviews_no_delete` BEFORE DELETE ON `privacy_reviews` BEGIN SELECT RAISE(ABORT, 'privacy_reviews are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `publication_revisions_no_update` BEFORE UPDATE ON `publication_revisions` BEGIN SELECT RAISE(ABORT, 'publication_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `publication_revisions_no_delete` BEFORE DELETE ON `publication_revisions` BEGIN SELECT RAISE(ABORT, 'publication_revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `publication_approvals_no_update` BEFORE UPDATE ON `publication_approvals` BEGIN SELECT RAISE(ABORT, 'publication_approvals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `publication_approvals_no_delete` BEFORE DELETE ON `publication_approvals` BEGIN SELECT RAISE(ABORT, 'publication_approvals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `artifacts_no_update` BEFORE UPDATE ON `artifacts` BEGIN SELECT RAISE(ABORT, 'artifacts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `artifacts_no_delete` BEFORE DELETE ON `artifacts` BEGIN SELECT RAISE(ABORT, 'artifacts are immutable'); END;
