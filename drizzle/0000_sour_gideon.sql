CREATE TABLE `request_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `request_limits_reset_at_idx` ON `request_limits` (`reset_at`);