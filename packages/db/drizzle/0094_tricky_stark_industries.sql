ALTER TABLE `terminal_sessions` ADD `supervision_id` text;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `supervision_desired` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `supervision_attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `terminal_sessions`
SET `supervision_id` = `id`, `supervision_desired` = true
WHERE `restart_policy` = 'until_stopped'
  AND `launch_command` IS NOT NULL
  AND `status` IN ('starting', 'running', 'disconnected');--> statement-breakpoint
CREATE INDEX `terminal_sessions_host_supervision_idx` ON `terminal_sessions` (`host_id`,`supervision_desired`);--> statement-breakpoint
CREATE INDEX `terminal_sessions_supervision_idx` ON `terminal_sessions` (`supervision_id`);
