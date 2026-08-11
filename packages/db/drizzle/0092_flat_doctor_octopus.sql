ALTER TABLE `app_settings` ADD `dev_server_restart_policy` text DEFAULT 'until_stopped' NOT NULL;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `launch_command` text;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `restart_policy` text DEFAULT 'never' NOT NULL;