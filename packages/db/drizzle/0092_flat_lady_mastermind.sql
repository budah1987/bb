ALTER TABLE `app_settings` ADD `dev_server_restart_policy` text DEFAULT 'until_stopped' NOT NULL;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `launch_command` text;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `dev_server_port` integer;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `restart_policy` text DEFAULT 'never' NOT NULL;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `supervision_id` text;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `supervision_desired` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `supervision_attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `terminal_sessions_host_supervision_idx` ON `terminal_sessions` (`host_id`,`supervision_desired`);--> statement-breakpoint
CREATE INDEX `terminal_sessions_supervision_idx` ON `terminal_sessions` (`supervision_id`);
