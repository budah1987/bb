ALTER TABLE `events` ADD `daemon_event_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `events_daemon_event_id_idx` ON `events` (`daemon_event_id`);