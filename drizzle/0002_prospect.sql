CREATE TABLE `audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prospect_id` integer NOT NULL,
	`url` text NOT NULL,
	`final_url` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`https` integer,
	`mobile` integer,
	`performance` integer,
	`accessibility` integer,
	`seo` integer,
	`best_practices` integer,
	`lcp_ms` integer,
	`stack` text DEFAULT '[]' NOT NULL,
	`has_form` integer,
	`has_booking` integer,
	`issues` text DEFAULT '[]' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audits_prospect_idx` ON `audits` (`prospect_id`,`id`);--> statement-breakpoint
CREATE INDEX `audits_status_idx` ON `audits` (`status`);--> statement-breakpoint
CREATE TABLE `prospects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`segment_id` integer,
	`name` text NOT NULL,
	`country` text NOT NULL,
	`city` text,
	`region` text,
	`address` text,
	`website` text,
	`phone` text,
	`registry_id` text,
	`place_id` text,
	`sector_code` text,
	`sector_label` text,
	`employees_min` integer,
	`employees_max` integer,
	`founded_at` text,
	`source` text NOT NULL,
	`legal_basis` text DEFAULT 'b2b_optout' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`fit_score` integer,
	`need_score` integer,
	`fresh_score` integer,
	`score` integer,
	`scored_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prospects_registry_id_unique` ON `prospects` (`registry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `prospects_place_id_unique` ON `prospects` (`place_id`);--> statement-breakpoint
CREATE INDEX `prospects_segment_idx` ON `prospects` (`segment_id`,`score`);--> statement-breakpoint
CREATE INDEX `prospects_score_idx` ON `prospects` (`score`);--> statement-breakpoint
CREATE INDEX `prospects_website_idx` ON `prospects` (`website`);--> statement-breakpoint
CREATE TABLE `searches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`segment_id` integer NOT NULL,
	`query` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`found` integer DEFAULT 0 NOT NULL,
	`added` integer DEFAULT 0 NOT NULL,
	`paid_calls` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `searches_status_idx` ON `searches` (`status`);--> statement-breakpoint
CREATE INDEX `searches_segment_idx` ON `searches` (`segment_id`);--> statement-breakpoint
CREATE TABLE `segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`market` text NOT NULL,
	`sector` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`queries` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`job_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
