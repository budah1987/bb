CREATE TABLE `project_scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`shortcut` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_scripts_name_idx` ON `project_scripts` (`project_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_scripts_shortcut_idx` ON `project_scripts` (`project_id`,`shortcut`);