CREATE TABLE `ai_analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`job_id` integer,
	`store_id` integer,
	`store_ids_json` text DEFAULT '[]' NOT NULL,
	`input_json` text NOT NULL,
	`result_json` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ai_analyses_store_created` ON `ai_analyses` (`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_analyses_job_scope_created` ON `ai_analyses` (`job_id`,`scope`,`created_at`);