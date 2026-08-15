CREATE TABLE `plugin_marketplace_icons` (
	`marketplace_name` text NOT NULL,
	`entry_id` text NOT NULL,
	`source_url` text NOT NULL,
	`content_type` text NOT NULL,
	`etag` text,
	`content_hash` text NOT NULL,
	`bytes` blob NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`marketplace_name`, `entry_id`)
);
--> statement-breakpoint
CREATE TABLE `plugin_marketplaces` (
	`name` text PRIMARY KEY NOT NULL,
	`source_kind` text DEFAULT 'https' NOT NULL,
	`manifest_url` text NOT NULL,
	`source_git_ref` text,
	`source_git_commit` text,
	`manifest_json` text NOT NULL,
	`etag` text,
	`last_modified` text,
	`last_successful_refresh_at` integer,
	`last_attempted_refresh_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS `thread_search_segments_thread_idx`;--> statement-breakpoint
CREATE INDEX `thread_search_segments_thread_source_seq_idx` ON `thread_search_segments` (`thread_id`,`source_seq`);--> statement-breakpoint
ALTER TABLE `environments` ADD `retire_requested_at` integer;
--> statement-breakpoint
UPDATE `environments`
SET `retire_requested_at` = `updated_at`
WHERE `status` = 'retiring';--> statement-breakpoint
ALTER TABLE `plugins` ADD `catalog_marketplace_name` text;
--> statement-breakpoint
UPDATE `plugins`
SET `catalog_marketplace_name` = 'bb-official'
WHERE `provenance` = 'catalog';--> statement-breakpoint
ALTER TABLE `plugins` ADD `source_git_range` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `source_git_tag_prefix` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `source_git_resolved_tag` text;--> statement-breakpoint
ALTER TABLE `plugin_artifacts` ADD `git_checkout_root` text;
--> statement-breakpoint
UPDATE `plugin_artifacts`
SET `git_checkout_root` = substr(
  `path`,
  1,
  instr(`path`, '/' || `git_resolved_commit` || '/') + length(`git_resolved_commit`)
)
WHERE `source_kind` = 'git'
  AND `git_checkout_root` IS NULL
  AND `git_resolved_commit` IS NOT NULL
  AND instr(`path`, '/' || `git_resolved_commit` || '/') > 0;
--> statement-breakpoint
UPDATE `plugin_artifacts`
SET `git_checkout_root` = substr(
  `path`,
  1,
  instr(`path`, '\' || `git_resolved_commit` || '\') + length(`git_resolved_commit`)
)
WHERE `source_kind` = 'git'
  AND `git_checkout_root` IS NULL
  AND `git_resolved_commit` IS NOT NULL
  AND instr(`path`, '\' || `git_resolved_commit` || '\') > 0;
--> statement-breakpoint
UPDATE `plugin_artifacts`
SET `git_checkout_root` = `path`
WHERE `source_kind` = 'git'
  AND `git_checkout_root` IS NULL
  AND `git_resolved_commit` IS NOT NULL
  AND (
    `path` LIKE '%/' || `git_resolved_commit`
    OR `path` LIKE '%\' || `git_resolved_commit`
  );--> statement-breakpoint
ALTER TABLE `threads` DROP COLUMN `child_origin`;