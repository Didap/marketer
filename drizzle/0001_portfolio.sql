CREATE TABLE `portfolio_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`sectors` text DEFAULT '[]' NOT NULL,
	`client` text,
	`problem` text DEFAULT '' NOT NULL,
	`solution` text DEFAULT '' NOT NULL,
	`results` text DEFAULT '' NOT NULL,
	`stack` text DEFAULT '' NOT NULL,
	`url` text,
	`year` integer,
	`tags` text DEFAULT '[]' NOT NULL,
	`related` text DEFAULT '[]' NOT NULL,
	`citable` integer DEFAULT false NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`proposal` text,
	`edited_at` integer,
	`reviewed_at` integer,
	`job_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_items_slug_unique` ON `portfolio_items` (`slug`);--> statement-breakpoint
CREATE INDEX `portfolio_items_kind_idx` ON `portfolio_items` (`kind`,`status`);--> statement-breakpoint
CREATE TABLE `portfolio_sources` (
	`path` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`imported_at` integer,
	`fingerprint` text,
	`ignored_reason` text,
	`job_id` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
