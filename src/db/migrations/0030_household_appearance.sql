CREATE TABLE "household_appearance" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"theme" text DEFAULT 'hearth' NOT NULL,
	CONSTRAINT "household_appearance_singleton" CHECK ("household_appearance"."singleton")
);
