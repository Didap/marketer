ALTER TABLE `prospect_contacts` ADD `linkedin_url` text;--> statement-breakpoint
ALTER TABLE `prospect_contacts` ADD `linkedin_activity` text;--> statement-breakpoint
ALTER TABLE `prospect_contacts` ADD `linkedin_note` text;--> statement-breakpoint
ALTER TABLE `prospect_contacts` ADD `linkedin_checked_at` integer;--> statement-breakpoint
UPDATE `prospects` SET `legal_basis` = 'public_office' WHERE `source` = 'it_comuni' AND `legal_basis` = 'b2b_optout';
