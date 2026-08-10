CREATE TABLE IF NOT EXISTS `browser_annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`environment_id` text,
	`browser_tab_id` text NOT NULL,
	`url` text NOT NULL,
	`selector` text NOT NULL,
	`viewport_width` real NOT NULL,
	`viewport_height` real NOT NULL,
	`rectangle_x` real NOT NULL,
	`rectangle_y` real NOT NULL,
	`rectangle_width` real NOT NULL,
	`rectangle_height` real NOT NULL,
	`comment` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `browser_annotations_thread_status_updated_idx` ON `browser_annotations` (`thread_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `browser_annotations_thread_tab_updated_idx` ON `browser_annotations` (`thread_id`,`browser_tab_id`,`updated_at`);
