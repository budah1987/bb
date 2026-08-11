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
--> statement-breakpoint
ALTER TABLE `app_settings` ADD `dev_server_restart_policy` text DEFAULT 'until_stopped' NOT NULL;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `launch_command` text;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `dev_server_port` integer;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `restart_policy` text DEFAULT 'never' NOT NULL;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `supervision_id` text;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `supervision_desired` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `supervision_attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `terminal_sessions_host_supervision_idx` ON `terminal_sessions` (`host_id`,`supervision_desired`);--> statement-breakpoint
CREATE INDEX `terminal_sessions_supervision_idx` ON `terminal_sessions` (`supervision_id`);
