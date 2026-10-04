CREATE TABLE `source_spans` (
	`id` text PRIMARY KEY NOT NULL,
	`normalization_revision_id` text NOT NULL,
	`block_id` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`normalization_revision_id`,`block_id`) REFERENCES `source_blocks`(`normalization_revision_id`,`block_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TRIGGER `source_spans_no_update` BEFORE UPDATE ON `source_spans` BEGIN SELECT RAISE(ABORT, 'source_spans are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `source_spans_no_delete` BEFORE DELETE ON `source_spans` BEGIN SELECT RAISE(ABORT, 'source_spans are immutable'); END;
