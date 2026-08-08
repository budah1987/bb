CREATE TABLE IF NOT EXISTS `thread_notes` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`scratchpad` text DEFAULT '' NOT NULL,
	`recap_body` text,
	`recap_source_seq` integer,
	`recap_generated_at` integer,
	`recap_enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
