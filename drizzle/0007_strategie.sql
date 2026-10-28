CREATE TABLE `strategies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`prospect_ids` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`first_contacts` text DEFAULT '[]' NOT NULL,
	`opening_subject` text,
	`opening_body` text,
	`notes` text DEFAULT '' NOT NULL,
	`job_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
