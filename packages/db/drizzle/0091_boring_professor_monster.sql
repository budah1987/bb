CREATE TABLE IF NOT EXISTS `project_manager_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`provider_id` text NOT NULL,
	`model` text NOT NULL,
	`reasoning_level` text NOT NULL,
	`service_tier` text NOT NULL,
	`permission_mode` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
