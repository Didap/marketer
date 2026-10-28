CREATE TABLE `prospect_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prospect_id` integer NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`lists` text,
	`since` text,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prospect_contacts_prospect_idx` ON `prospect_contacts` (`prospect_id`);--> statement-breakpoint
ALTER TABLE `prospects` ADD `email` text;--> statement-breakpoint
ALTER TABLE `prospects` ADD `population` integer;--> statement-breakpoint
ALTER TABLE `prospects` ADD `elected_at` text;--> statement-breakpoint
ALTER TABLE `prospects` ADD `political_side` text;