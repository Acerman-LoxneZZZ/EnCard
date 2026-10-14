CREATE TABLE `profiles` (
	`telegram_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`avatar` text,
	`document` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
