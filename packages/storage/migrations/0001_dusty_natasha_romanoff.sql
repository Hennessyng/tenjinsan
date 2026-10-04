ALTER TABLE `external_attempts` ADD `reservation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `external_attempts` ADD `response_body` blob;--> statement-breakpoint
UPDATE `external_attempts` SET `reservation` = CAST(json_extract(`record_json`, '$.reservation') AS integer);--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_run_reservation_unique` ON `external_attempts` (`run_id`,`reservation`);--> statement-breakpoint
ALTER TABLE `generation_runs` ADD `reserved_calls` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `generation_runs` SET `reserved_calls` = CAST(json_extract(`record_json`, '$.reservedCalls') AS integer);--> statement-breakpoint
ALTER TABLE `jobs` ADD `checkpoint` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `cancellation_requested` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `lease_fence` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `lease_token` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `lease_expires_at` text;--> statement-breakpoint
UPDATE `jobs` SET
  `checkpoint` = json_extract(`record_json`, '$.checkpoint'),
  `cancellation_requested` = CAST(json_extract(`record_json`, '$.cancellationRequested') AS integer),
  `lease_fence` = COALESCE(CAST(json_extract(`record_json`, '$.lease.fence') AS integer), 0),
  `lease_token` = json_extract(`record_json`, '$.lease.token'),
  `lease_expires_at` = json_extract(`record_json`, '$.lease.expiresAt');
