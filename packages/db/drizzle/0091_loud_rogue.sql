CREATE TABLE IF NOT EXISTS `space_projects` (
	`project_id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `space_projects_space_idx` ON `space_projects` (`space_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text NOT NULL,
	`color` text NOT NULL,
	`sort_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `spaces_sort_idx` ON `spaces` (`sort_key`,`id`);--> statement-breakpoint
INSERT OR IGNORE INTO `spaces` (`id`, `name`, `icon`, `color`, `sort_key`, `created_at`, `updated_at`)
VALUES ('space_default', 'Main', 'layers', 'sage', 'V', 1786403723649, 1786403723649);--> statement-breakpoint
INSERT OR IGNORE INTO `space_projects` (`project_id`, `space_id`, `updated_at`)
SELECT `id`, 'space_default', 1786403723649
FROM `projects`
WHERE `kind` = 'standard' AND `deleted_at` IS NULL;
