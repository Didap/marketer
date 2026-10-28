CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`segment_id` integer NOT NULL,
	`identity_id` integer NOT NULL,
	`language` text NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ideas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prospect_id` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`pitch` text NOT NULL,
	`effort` text DEFAULT '' NOT NULL,
	`price_band` text DEFAULT '' NOT NULL,
	`portfolio_slug` text,
	`job_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ideas_prospect_idx` ON `ideas` (`prospect_id`);--> statement-breakpoint
CREATE TABLE `identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`languages` text DEFAULT '[]' NOT NULL,
	`email` text,
	`linkedin_url` text,
	`phone` text,
	`signature` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer,
	`prospect_id` integer NOT NULL,
	`identity_id` integer NOT NULL,
	`step` integer DEFAULT 0 NOT NULL,
	`channel` text NOT NULL,
	`language` text NOT NULL,
	`subject` text,
	`body` text NOT NULL,
	`idea_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`legal_basis` text NOT NULL,
	`telegram_message_id` integer,
	`notified_at` integer,
	`edited_at` integer,
	`decided_at` integer,
	`job_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `messages_status_idx` ON `messages` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `messages_prospect_idx` ON `messages` (`prospect_id`);--> statement-breakpoint
CREATE INDEX `messages_campaign_idx` ON `messages` (`campaign_id`,`prospect_id`,`step`);