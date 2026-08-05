CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filename` text,
	`status` text DEFAULT '等待开始匹配' NOT NULL,
	`total_stores` integer DEFAULT 0 NOT NULL,
	`processed_stores` integer DEFAULT 0 NOT NULL,
	`matched_stores` integer DEFAULT 0 NOT NULL,
	`success_stores` integer DEFAULT 0 NOT NULL,
	`failed_stores` integer DEFAULT 0 NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`stage` text DEFAULT 'match' NOT NULL,
	`control` text DEFAULT 'idle' NOT NULL,
	`current_store` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_created_at` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `stores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer,
	`input_name` text NOT NULL,
	`standard_name` text,
	`amap_poi_id` text,
	`longitude` real,
	`latitude` real,
	`province` text DEFAULT '',
	`city` text DEFAULT '',
	`district` text DEFAULT '',
	`address` text DEFAULT '',
	`user_code` text,
	`brand` text,
	`match_score` real,
	`match_status` text DEFAULT '',
	`status` text DEFAULT '等待匹配' NOT NULL,
	`error_message` text,
	`pois_json` text DEFAULT '[]' NOT NULL,
	`analysis_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_stores_job_id` ON `stores` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_stores_status` ON `stores` (`status`);