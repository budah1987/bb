ALTER TABLE `system_experiments` ADD `new_onboarding` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_background_task_thread_type_item_sequence_idx` ON `events` (`thread_id`,`type`,`item_id`,`sequence`) WHERE "events"."item_kind" = 'backgroundTask';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_goal_thread_sequence_idx` ON `events` (`thread_id`,`sequence`) WHERE "events"."type" IN ('thread/goal/updated', 'thread/goal/cleared');
