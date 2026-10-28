CREATE TABLE `activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`job_id` integer,
	`text` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activity_at_idx` ON `activity` (`at`);--> statement-breakpoint
CREATE TABLE `heartbeats` (
	`name` text PRIMARY KEY NOT NULL,
	`pid` integer NOT NULL,
	`at` integer NOT NULL,
	`started_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`payload` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_events_job_idx` ON `job_events` (`job_id`,`id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'free' NOT NULL,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`cwd` text NOT NULL,
	`permission` text DEFAULT 'read' NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`day` text,
	`pid` integer,
	`session_id` text,
	`model` text,
	`num_turns` integer,
	`duration_ms` integer,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`weighted_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`result` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_day_idx` ON `jobs` (`day`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
